import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

export function Scene3() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 200),
      setTimeout(() => setPhase(2), 1000),
      setTimeout(() => setPhase(3), 1800),
      setTimeout(() => setPhase(4), 3800), // Exiting
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center overflow-hidden z-20"
      initial={{ clipPath: 'circle(0% at 50% 50%)' }}
      animate={{ clipPath: 'circle(150% at 50% 50%)' }}
      exit={{ clipPath: 'circle(0% at 50% 50%)' }}
      transition={{ duration: 1.2, ease: [0.65, 0, 0.35, 1] }}
    >
      <div className="absolute inset-0 bg-[#06D6A0]/10" />

      <motion.div
        className="text-center"
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.8, delay: 0.2 }}
      >
        <h2 
          className="text-[7vw] leading-none font-bold tracking-tighter"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          <motion.span 
            className="block text-[#06D6A0]"
            initial={{ y: '2vh', opacity: 0 }}
            animate={phase >= 1 ? { y: 0, opacity: 1 } : { y: '2vh', opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          >
            Zero hassle.
          </motion.span>
          <motion.span 
            className="block text-white mt-[1vh]"
            initial={{ y: '2vh', opacity: 0 }}
            animate={phase >= 2 ? { y: 0, opacity: 1 } : { y: '2vh', opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          >
            Full confidence.
          </motion.span>
        </h2>
      </motion.div>

      <motion.div 
        className="mt-[6vh] flex space-x-[2vw]"
        initial={{ y: '4vh', opacity: 0 }}
        animate={phase >= 3 ? { y: 0, opacity: 1 } : { y: '4vh', opacity: 0 }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
      >
        {['Verified Reviews', 'Direct Messaging', 'Save Favourites'].map((tag, i) => (
          <div key={i} className="px-[2.5vw] py-[1.5vh] rounded-full bg-[#111827] border border-[#06D6A0]/30 shadow-lg shadow-[#06D6A0]/10 flex items-center space-x-[1vw]">
            <div className="w-[1.5vw] h-[1.5vw] rounded-full bg-[#06D6A0] flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-[1vw] h-[1vw] text-[#0B1120]" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </div>
            <span className="text-[1.5vw] font-semibold">{tag}</span>
          </div>
        ))}
      </motion.div>
    </motion.div>
  );
}