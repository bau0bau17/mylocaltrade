import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import logoPng from "@assets/mylocaltrade-logo.png";

export function Scene5() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 2500),
      setTimeout(() => setPhase(4), 5000), // Exiting
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center overflow-hidden z-20 bg-[#0B1120]"
      initial={{ opacity: 0, scale: 1.1 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 1, ease: 'easeOut' }}
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-[#00B4D8]/20 via-[#0B1120] to-[#0B1120]" />

      <motion.div
        className="flex items-center gap-[2vw] mb-[5vh] relative z-10"
        initial={{ opacity: 0, y: '5vh' }}
        animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: '5vh' }}
        transition={{ type: 'spring', stiffness: 200, damping: 20 }}
      >
        {/* App icon tile */}
        <div className="relative shrink-0">
          <div className="absolute -inset-[1.2vw] rounded-[2.6vw] bg-[#00B4D8]/30 blur-[2.5vw]" />
          <img
            src={logoPng}
            alt="MyLocalTrade"
            className="relative w-[8vw] h-[8vw] rounded-[1.9vw] ring-1 ring-white/20 shadow-[0_1.5vh_4vh_rgba(0,0,0,0.55)]"
          />
        </div>

        {/* Wordmark lockup */}
        <div className="flex items-center gap-[1.1vw]">
          <div className="w-[0.45vw] h-[4.6vw] rounded-full bg-[#00B4D8]" />
          <span
            className="text-[5.4vw] font-bold tracking-tighter leading-none text-white"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            MyLocalTrade
          </span>
        </div>
      </motion.div>

      <motion.p
        className="text-[2.5vw] font-medium text-white/80 tracking-wide text-center"
        initial={{ opacity: 0, filter: 'blur(10px)' }}
        animate={phase >= 2 ? { opacity: 1, filter: 'blur(0px)' } : { opacity: 0, filter: 'blur(10px)' }}
        transition={{ duration: 0.8 }}
      >
        Find independent local tradespeople
        <br />
        <span className="text-[#00B4D8] font-semibold">across the UK.</span>
      </motion.p>

      <motion.div
        className="mt-[6vh] flex space-x-[2vw] relative z-10"
        initial={{ opacity: 0, y: '3vh' }}
        animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: '3vh' }}
        transition={{ duration: 0.6 }}
      >
        <div className="px-[3vw] py-[2vh] rounded-full bg-white text-[#0B1120] font-bold text-[1.5vw] shadow-[0_0_30px_rgba(255,255,255,0.3)] hover:scale-105 transition-transform cursor-default">
          Download the App
        </div>
      </motion.div>
      
      {/* Decorative floating elements for the final scene */}
      <motion.div 
        className="absolute w-[3vw] h-[3vw] rounded-full border-2 border-[#00B4D8]/40 top-[20%] left-[20%]"
        animate={{ y: [0, -20, 0], opacity: [0, 1, 0] }}
        transition={{ duration: 4, repeat: Infinity, delay: 0.5 }}
      />
      <motion.div 
        className="absolute w-[2vw] h-[2vw] rounded-full bg-[#06D6A0]/40 bottom-[25%] right-[25%]"
        animate={{ y: [0, 20, 0], opacity: [0, 1, 0] }}
        transition={{ duration: 3.5, repeat: Infinity, delay: 1.2 }}
      />
    </motion.div>
  );
}