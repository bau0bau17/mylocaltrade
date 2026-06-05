import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

export function Scene4() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 1000),
      setTimeout(() => setPhase(3), 1800),
      setTimeout(() => setPhase(4), 3800), // Exiting
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex items-center overflow-hidden z-20"
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ opacity: 0, filter: 'blur(20px)' }}
      transition={{ duration: 1, ease: [0.76, 0, 0.24, 1] }}
    >
      <div className="w-1/2 h-full flex flex-col justify-center pl-[10vw]">
        <motion.div
          className="inline-block px-[1.5vw] py-[0.8vh] rounded-md bg-[#F59E0B]/20 text-[#F59E0B] font-bold text-[1.2vw] tracking-wider uppercase mb-[3vh]"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={phase >= 1 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.8 }}
        >
          For Traders
        </motion.div>
        
        <h2 
          className="text-[5vw] leading-[1.1] font-bold tracking-tight mb-[3vh]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          <motion.span 
            className="block"
            initial={{ opacity: 0, y: '3vh' }}
            animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: '3vh' }}
            transition={{ duration: 0.7 }}
          >
            Grow your
          </motion.span>
          <motion.span 
            className="block text-[#F59E0B]"
            initial={{ opacity: 0, y: '3vh' }}
            animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: '3vh' }}
            transition={{ duration: 0.7, delay: 0.1 }}
          >
            local business.
          </motion.span>
        </h2>
        
        <motion.p 
          className="text-[2vw] text-white/70 max-w-[35vw]"
          initial={{ opacity: 0 }}
          animate={phase >= 3 ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.7, delay: 0.3 }}
        >
          Manage leads, build your profile, and become a Featured Trader.
        </motion.p>
      </div>

      <div className="w-1/2 h-full relative flex items-center justify-center">
        <motion.div
          className="w-[30vw] bg-[#111827] rounded-2xl border border-white/10 shadow-2xl p-[3vh] relative overflow-hidden"
          initial={{ y: '20vh', opacity: 0, rotateY: -30, perspective: 1000 }}
          animate={phase >= 2 ? { y: 0, opacity: 1, rotateY: -10 } : { y: '20vh', opacity: 0, rotateY: -30 }}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        >
          {/* Decorative glare */}
          <div className="absolute top-0 right-0 w-full h-[30%] bg-gradient-to-b from-[#F59E0B]/20 to-transparent pointer-events-none" />
          
          <div className="flex items-center space-x-[2vw] mb-[3vh]">
            <div className="w-[6vw] h-[6vw] rounded-full bg-gray-700 overflow-hidden border-2 border-[#F59E0B]">
              <img src={`${import.meta.env.BASE_URL}images/plumber.jpg`} className="w-full h-full object-cover object-top" />
            </div>
            <div>
              <h3 className="text-[2vw] font-bold">John's Plumbing</h3>
              <div className="flex items-center space-x-[0.5vw] text-[#F59E0B]">
                <svg viewBox="0 0 24 24" className="w-[1.2vw] h-[1.2vw]" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                <span className="text-[1.2vw] font-semibold text-white">5.0 (124 reviews)</span>
              </div>
            </div>
          </div>

          <div className="space-y-[2vh]">
            <div className="flex justify-between items-center p-[2vh] bg-white/5 rounded-xl border border-white/5">
              <span className="text-[1.4vw] text-white/60">New Leads</span>
              <span className="text-[1.8vw] font-bold text-[#06D6A0]">+12 today</span>
            </div>
            <div className="flex justify-between items-center p-[2vh] bg-[#F59E0B]/10 rounded-xl border border-[#F59E0B]/30">
              <span className="text-[1.4vw] text-[#F59E0B] font-semibold">Featured Badge</span>
              <span className="text-[1.2vw] px-[1vw] py-[0.5vh] rounded-full bg-[#F59E0B] text-[#0B1120] font-bold">Active</span>
            </div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}