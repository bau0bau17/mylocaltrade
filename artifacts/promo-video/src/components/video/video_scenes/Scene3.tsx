import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

const appScreen = `${import.meta.env.BASE_URL}images/app-home.jpg`;

export function Scene3() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 200),
      setTimeout(() => setPhase(2), 1000),
      setTimeout(() => setPhase(3), 1800),
      setTimeout(() => setPhase(4), 5800), // Exiting
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-center overflow-hidden z-20"
      initial={{ clipPath: 'circle(0% at 50% 50%)' }}
      animate={{ clipPath: 'circle(150% at 50% 50%)' }}
      exit={{ clipPath: 'circle(0% at 50% 50%)' }}
      transition={{ duration: 1.2, ease: [0.65, 0, 0.35, 1] }}
    >
      <div className="absolute inset-0 bg-[#06D6A0]/10" />

      <div className="absolute inset-0 flex px-[6vw]">
        {/* Left Side: Text */}
        <div className="w-[55%] h-full flex flex-col justify-center pr-[4vw]">
          <motion.div
            initial={{ scale: 0.9, opacity: 0, x: '-5vw' }}
            animate={{ scale: 1, opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
          >
            <h2 
              className="text-[9.5vw] leading-[1] font-bold tracking-tighter"
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
                className="block text-white mt-[1.5vh]"
                initial={{ y: '2vh', opacity: 0 }}
                animate={phase >= 2 ? { y: 0, opacity: 1 } : { y: '2vh', opacity: 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              >
                Full confidence.
              </motion.span>
            </h2>
          </motion.div>

          <motion.div 
            className="mt-[8vh] flex flex-col space-y-[3vh]"
            initial={{ y: '4vh', opacity: 0 }}
            animate={phase >= 3 ? { y: 0, opacity: 1 } : { y: '4vh', opacity: 0 }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
          >
            {['Verified Reviews', 'Direct Messaging'].map((tag, i) => (
              <div key={i} className="px-[3vw] py-[2vh] rounded-2xl bg-[#111827] border-2 border-[#06D6A0]/40 shadow-xl shadow-[#06D6A0]/10 flex items-center space-x-[2vw] w-fit">
                <div className="w-[3.5vw] h-[3.5vw] rounded-full bg-[#06D6A0] flex items-center justify-center">
                  <svg viewBox="0 0 24 24" className="w-[2vw] h-[2vw] text-[#0B1120]" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                </div>
                <span className="text-[3.5vw] font-bold text-white">{tag}</span>
              </div>
            ))}
          </motion.div>
        </div>

        {/* Right Side: Phone Mockup */}
        <div className="w-[45%] h-full flex items-center justify-center relative perspective-[1200px]">
          <motion.div
            className="relative w-[45vw] h-[92vh] mt-[4vh]"
            initial={{ opacity: 0, y: '30vh', rotateY: 25, rotateX: 10, rotateZ: -3, scale: 0.8 }}
            animate={phase >= 2 ? { opacity: 1, y: '0vh', rotateY: -10, rotateX: 0, rotateZ: 0, scale: 1 } : { opacity: 0, y: '30vh', rotateY: 25, rotateX: 10, rotateZ: -3, scale: 0.8 }}
            transition={{ type: 'spring', stiffness: 80, damping: 20, delay: 0.3 }}
          >
             {/* Float animation */}
            <motion.div
               animate={{ y: [0, -20, 0] }}
               transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
               className="w-full h-full relative flex justify-center items-center"
            >
              {/* Phone body */}
              <div className="relative h-full aspect-[390/844] rounded-[4vw] bg-[#0A0D13] p-[1vw] ring-2 ring-white/20 shadow-[0_40px_100px_rgba(6,214,160,0.4),0_15px_50px_rgba(0,0,0,0.7)]">
                {/* Screen */}
                <div className="relative w-full h-full rounded-[3vw] overflow-hidden bg-black">
                  <img
                    src={appScreen}
                    alt="MyLocalTrade App"
                    className="w-full h-full object-cover"
                  />
                  {/* Removed dynamic island for website clarity */}
                </div>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}