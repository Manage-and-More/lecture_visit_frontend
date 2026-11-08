/**
 * Lecture Visit mail bridge.
 *
 * Runs in the Google account that sends the outreach emails (nick.dienemann@manageandmore.de),
 * every 5 minutes via a time trigger:
 *   1. asks the Lecture Visit tool which emails to send and which Gmail threads to watch,
 *   2. sends those emails from this account and labels their threads "Lecture Visit",
 *   3. reports what it sent plus new replies in watched threads (and bounces) back to the tool.
 * The tool decides everything (limits, test mode, texts); this script only moves mail.
 * It signs its requests with this account's Google identity token; there is no shared secret.
 *
 * Setup: paste this file and appsscript.json into the Apps Script project, run
 * checkConnection() once, then installTrigger(). The source of truth is apps-script/ in the
 * lecture_visit_frontend repository.
 */

var APP_URL = 'https://mm-lecture-visit.fly.dev';
var LABEL_NAME = 'Lecture Visit';
// Look a little further back than the last run, in case Gmail indexes a reply late
var OVERLAP_SECONDS = 600;

function sync() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return; // the previous run is still busy
  try {
    var props = PropertiesService.getScriptProperties();
    var me = Session.getActiveUser().getEmail().toLowerCase();
    var startedAt = Math.floor(Date.now() / 1000);
    var pull = callTool_('/api/mail/pull', {});
    var label = GmailApp.getUserLabelByName(LABEL_NAME) || GmailApp.createLabel(LABEL_NAME);

    var sent = (pull.outbox || []).map(function (m) { return send_(m, label); });

    var tracked = {};
    (pull.trackedThreadIds || []).forEach(function (id) { tracked[id] = true; });
    sent.forEach(function (s) { if (s.gmailThreadId) tracked[s.gmailThreadId] = true; });

    var since = Number(props.getProperty('lastInboundCheck')) || startedAt - 3 * 86400;
    var inbound = collectInbound_(since - OVERLAP_SECONDS, tracked, me);

    // Send results are kept until the tool has them, so a failed report doesn't make an
    // email that went out look unsent
    var unreported = JSON.parse(props.getProperty('unreportedSent') || '[]').concat(sent);
    props.setProperty('unreportedSent', JSON.stringify(unreported));
    callTool_('/api/mail/push', { sent: unreported, inbound: inbound });
    props.deleteProperty('unreportedSent');
    props.setProperty('lastInboundCheck', String(startedAt));
  } finally {
    lock.releaseLock();
  }
}

function send_(m, label) {
  try {
    var options = { name: m.senderName };
    if (m.cc && m.cc.length) options.cc = m.cc.join(',');
    var message;
    if (m.replyToGmailMessageId) {
      // Answer the lecturer's email inside their thread
      message = GmailApp.getMessageById(m.replyToGmailMessageId).createDraftReply(m.body, options).send();
    } else {
      message = GmailApp.createDraft(m.to.join(','), m.subject, m.body, options).send();
    }
    var thread = message.getThread();
    thread.addLabel(label);
    return { id: m.id, ok: true, gmailMessageId: message.getId(), gmailThreadId: thread.getId() };
  } catch (e) {
    return { id: m.id, ok: false, error: String((e && e.message) || e) };
  }
}

function collectInbound_(sinceSeconds, tracked, me) {
  var inbound = [];
  var threads = GmailApp.search('after:' + sinceSeconds + ' -from:me', 0, 200);
  threads.forEach(function (thread) {
    var isTracked = !!tracked[thread.getId()];
    thread.getMessages().forEach(function (msg) {
      if (msg.getDate().getTime() / 1000 < sinceSeconds) return;
      var from = msg.getFrom();
      if (from.toLowerCase().indexOf(me) !== -1) return;
      var isBounce = /mailer-daemon|postmaster/i.test(from);
      if (!isTracked && !isBounce) return;
      inbound.push({
        gmailMessageId: msg.getId(),
        gmailThreadId: thread.getId(),
        from: from,
        to: msg.getTo(),
        cc: msg.getCc(),
        date: msg.getDate().toISOString(),
        subject: msg.getSubject(),
        body: msg.getPlainBody().slice(0, 20000),
        isBounce: isBounce,
      });
    });
  });
  return inbound;
}

function callTool_(path, payload) {
  var response = UrlFetchApp.fetch(APP_URL + path, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    headers: { Authorization: 'Bearer ' + ScriptApp.getIdentityToken() },
    muteHttpExceptions: true,
  });
  var code = response.getResponseCode();
  var text = response.getContentText();
  if (code !== 200) throw new Error(path + ' answered HTTP ' + code + ': ' + text.slice(0, 500));
  return JSON.parse(text);
}

/** Run once by hand: checks that the tool accepts this account. Sends nothing. */
function checkConnection() {
  var token = ScriptApp.getIdentityToken();
  if (!token) throw new Error('No identity token: the openid scope is missing from appsscript.json');
  var part = token.split('.')[1];
  while (part.length % 4) part += '=';
  var claims = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(part)).getDataAsString());
  Logger.log('Token for ' + claims.email + ', audience ' + claims.aud);
  Logger.log('Tool answered: ' + JSON.stringify(callTool_('/api/mail/pull', { dryRun: true })));
}

/** Run once by hand: starts sync() every 5 minutes (replaces an existing trigger). */
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sync') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sync').timeBased().everyMinutes(5).create();
  Logger.log('sync() now runs every 5 minutes');
}

/** Stops the automatic runs. */
function removeTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sync') ScriptApp.deleteTrigger(t);
  });
  Logger.log('Automatic runs stopped');
}
