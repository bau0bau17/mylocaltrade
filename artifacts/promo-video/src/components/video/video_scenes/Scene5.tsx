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
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-[#00B4D8]/30 via-[#0B1120] to-[#0B1120]" />

      <motion.div
        className="flex items-center justify-center gap-[3vw] mb-[6vh] relative z-10 w-full"
        initial={{ opacity: 0, y: '5vh' }}
        animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: '5vh' }}
        transition={{ type: 'spring', stiffness: 200, damping: 20 }}
      >
        {/* App icon tile */}
        <div className="relative shrink-0">
          <div className="absolute -inset-[1.5vw] rounded-[3.5vw] bg-[#00B4D8]/40 blur-[3vw]" />
          <img
            src={logoPng}
            alt="MyLocalTrade"
            className="relative w-[14vw] h-[14vw] rounded-[3vw] ring-2 ring-white/30 shadow-[0_2vh_5vh_rgba(0,0,0,0.6)]"
          />
        </div>

        {/* Wordmark lockup */}
        <div className="flex items-center gap-[1.5vw]">
          <div className="w-[0.8vw] h-[10vw] rounded-full bg-[#00B4D8]" />
          <span
            className="text-[9.5vw] font-bold tracking-tighter leading-none text-white"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            MyLocalTrade
          </span>
        </div>
      </motion.div>

      <motion.p
        className="text-[4.5vw] font-medium text-white/90 tracking-wide text-center leading-[1.3] px-[5vw]"
        initial={{ opacity: 0, filter: 'blur(10px)' }}
        animate={phase >= 2 ? { opacity: 1, filter: 'blur(0px)' } : { opacity: 0, filter: 'blur(10px)' }}
        transition={{ duration: 0.8 }}
      >
        Find independent local tradespeople
        <br />
        <span className="text-[#00B4D8] font-bold text-[5.5vw]">across the UK.</span>
      </motion.p>

      <motion.div
        className="mt-[8vh] flex justify-center space-x-[2vw] relative z-10"
        initial={{ opacity: 0, y: '3vh' }}
        animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: '3vh' }}
        transition={{ duration: 0.6 }}
      >
        {/* App Store badge */}
        <div className="flex items-center gap-[1.5vw] px-[3vw] py-[2vh] rounded-[1.5vw] bg-black border-2 border-white/30 shadow-[0_1.5vh_4vh_rgba(0,0,0,0.5)]">
          <svg viewBox="0 0 24 24" fill="white" className="w-[5vw] h-[5vw] shrink-0">
            <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.464 2.338-1.282 3.714 1.345.104 2.726-.688 3.57-1.701"/>
          </svg>
          <div className="flex flex-col leading-none text-white text-left">
            <span className="text-[2.2vw] font-medium tracking-wide">Download on the</span>
            <span className="text-[4vw] font-bold -mt-[0.5vh]">App Store</span>
          </div>
        </div>
      </motion.div>
      
      {/* Decorative floating elements for the final scene */}
      <motion.div 
        className="absolute w-[6vw] h-[6vw] rounded-full border-4 border-[#00B4D8]/40 top-[15%] left-[15%]"
        animate={{ y: [0, -30, 0], opacity: [0, 1, 0] }}
        transition={{ duration: 4, repeat: Infinity, delay: 0.5 }}
      />
      <motion.div 
        className="absolute w-[4vw] h-[4vw] rounded-full bg-[#06D6A0]/40 bottom-[20%] right-[15%]"
        animate={{ y: [0, 30, 0], opacity: [0, 1, 0] }}
        transition={{ duration: 3.5, repeat: Infinity, delay: 1.2 }}
      />
    </motion.div>
  );
}