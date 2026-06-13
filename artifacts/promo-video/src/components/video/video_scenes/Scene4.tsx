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
      <div className="w-[50%] h-full flex flex-col justify-center pl-[8vw] pr-[2vw]">
        <motion.div
          className="inline-block px-[2vw] py-[1vh] rounded-lg bg-[#F59E0B]/20 text-[#F59E0B] font-bold text-[3vw] tracking-wider uppercase mb-[4vh] w-fit"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={phase >= 1 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.8 }}
        >
          For Traders
        </motion.div>
        
        <h2 
          className="text-[8vw] leading-[1.05] font-bold tracking-tight mb-[4vh]"
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
          className="text-[4vw] leading-[1.3] text-white/80 max-w-[45vw]"
          initial={{ opacity: 0 }}
          animate={phase >= 3 ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.7, delay: 0.3 }}
        >
          Manage leads and build your professional profile.
        </motion.p>
      </div>

      <div className="w-[50%] h-full relative flex items-center justify-center">
        <motion.div
          className="w-[42vw] bg-[#111827] rounded-3xl border-2 border-[#F59E0B]/30 shadow-[0_30px_80px_rgba(245,158,11,0.2)] p-[4vh] relative overflow-hidden"
          initial={{ y: '20vh', opacity: 0, rotateY: -30, perspective: 1000 }}
          animate={phase >= 2 ? { y: 0, opacity: 1, rotateY: -10 } : { y: '20vh', opacity: 0, rotateY: -30 }}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        >
          {/* Decorative glare */}
          <div className="absolute top-0 right-0 w-full h-[40%] bg-gradient-to-b from-[#F59E0B]/20 to-transparent pointer-events-none" />
          
          <div className="flex items-center space-x-[2.5vw] mb-[4vh]">
            <div className="w-[10vw] h-[10vw] rounded-full bg-gray-700 overflow-hidden border-4 border-[#F59E0B] shrink-0">
              <img src={`${import.meta.env.BASE_URL}images/plumber.jpg`} className="w-full h-full object-cover object-top" />
            </div>
            <div>
              <h3 className="text-[3.8vw] font-bold leading-tight mb-[1vh]">John's Plumbing</h3>
              <div className="flex items-center space-x-[1vw] text-[#F59E0B]">
                <svg viewBox="0 0 24 24" className="w-[2.5vw] h-[2.5vw]" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                <span className="text-[2.8vw] font-bold text-white">5.0</span>
              </div>
            </div>
          </div>

          <div className="space-y-[2.5vh]">
            <div className="flex justify-between items-center p-[2.5vh] bg-white/5 rounded-2xl border border-white/10">
              <span className="text-[3vw] font-medium text-white/80">New Leads</span>
              <span className="text-[3.5vw] font-bold text-[#06D6A0]">+12</span>
            </div>
            <div className="flex justify-between items-center p-[2.5vh] bg-[#F59E0B]/10 rounded-2xl border border-[#F59E0B]/40">
              <span className="text-[3vw] text-[#F59E0B] font-bold">Featured</span>
              <span className="text-[2.5vw] px-[2vw] py-[0.8vh] rounded-full bg-[#F59E0B] text-[#0B1120] font-black uppercase tracking-wider">Active</span>
            </div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}