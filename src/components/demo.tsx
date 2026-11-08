'use client';

import { DottedSurface } from "@/components/ui/dotted-surface";
import { cn } from '@/lib/utils';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';

const words = ['Lecture visits', 'Applications','for You' ];

export default function DemoOne() {
    const [currentIndex, setCurrentIndex] = useState(0);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        intervalRef.current = setInterval(() => {
            setCurrentIndex(prev => {
                if (prev >= words.length - 1) {
                    if (intervalRef.current) clearInterval(intervalRef.current);
                    return prev;
                }
                return prev + 1;
            });
        }, 2500);
        return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    }, []);

 return (
    <div className="relative min-h-screen bg-white text-black overflow-hidden">
        <style>{`
            @keyframes wordFlipIn {
                from {
                    opacity: 0;
                    transform: translateY(36px);
                    filter: blur(6px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                    filter: blur(0);
                }
            }
            .word-flip {
                animation: wordFlipIn 0.9s cubic-bezier(0.16, 1, 0.3, 1) forwards;
            }
        `}</style>
	<DottedSurface className="size-full" />

        {/* Logo */}
        <div className="absolute top-6 left-6 md:top-8 md:left-8 z-50">
            <img
                src="/logo.png"
                alt="Logo"
                className="w-24 h-24 md:w-24 md:h-24 object-contain"
            />
        </div>

        <div className="relative z-10 flex flex-col items-center justify-center min-h-screen w-full px-4 gap-8">
            <div
                aria-hidden="true"
                className={cn(
                    'pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full h-[600px] w-[600px]',
                    'bg-[radial-gradient(circle_at_center,rgba(0,120,255,0.05),transparent_70%)]',
                    'blur-[40px]',
                )}
            />

            <div className="text-center space-y-4">
                <h1 className="font-sans tracking-tight text-5xl md:text-7xl font-bold text-transparent">
                    <span className="inline-block bg-gradient-to-b from-black to-[#7A7A7A] bg-clip-text mr-[0.25em]">More</span>
                    <span key={currentIndex} className="word-flip inline-block bg-gradient-to-b from-black to-[#7A7A7A] bg-clip-text pb-[0.15em]">
                        {words[currentIndex]}
                    </span>
                </h1>
                <p className="text-xl md:text-2xl text-gray-500 max-w-[600px] mx-auto font-light">
                Inspire the next generation</p>
                <div className="pt-4">
                    <Link 
                        href="/outreach"
                        className="inline-flex items-center gap-2 bg-white/80 backdrop-blur-sm border border-black/10 text-black font-sans font-medium text-base md:text-lg px-6 py-3 rounded-xl hover:bg-black/5 hover:border-black/20 transition-all duration-200 shadow-sm"
                    >
                        Book visit <span aria-hidden="true">→</span>
                    </Link>
                </div>
            </div>


        </div>
	</div>
	);
}
