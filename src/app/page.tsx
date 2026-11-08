import { redirect } from 'next/navigation'

/** The app starts at /home; signed-out visitors are sent to the login page from there. */
export default function Root() {
  redirect('/home')
}
