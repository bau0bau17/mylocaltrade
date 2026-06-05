import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

export function Scene1() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 1200),
      setTimeout(() => setPhase(3), 2500),
      setTimeout(() => setPhase(4), 4000), // Exiting
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-center overflow-hidden z-20"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.1, filter: 'blur(10px)' }}
      transition={{ duration: 0.8 }}
    >
      {/* Background Image Layer */}
      <motion.div 
        className="absolute inset-0"
        initial={{ scale: 1.2, opacity: 0 }}
        animate={{ 
          scale: 1, 
          opacity: phase >= 4 ? 0 : 0.4 
        }}
        transition={{ duration: 4, ease: 'easeOut' }}
      >
        <img 
          src={`${import.meta.env.BASE_URL}images/home.jpg`} 
          alt="Home interior" 
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0B1120] via-[#0B1120]/60 to-transparent" />
      </motion.div>

      {/* Main Content */}
      <div className="relative z-10 flex flex-col items-center text-center px-[5vw]">
        <div className="overflow-hidden mb-[2vh]">
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: phase >= 1 ? '0%' : '100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="px-[2vw] py-[1vh] rounded-full bg-[#111827]/80 border border-[#00B4D8]/30 backdrop-blur-md"
          >
            <span className="text-[1.5vw] font-medium tracking-wide text-[#00B4D8] uppercase">
              For your home
            </span>
          </motion.div>
        </div>

        <h1 
          className="text-[6vw] leading-[1.1] font-bold tracking-tight mb-[3vh]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          <motion.span 
            className="block"
            initial={{ opacity: 0, y: '2vh', rotateX: -20 }}
            animate={phase >= 2 ? { opacity: 1, y: 0, rotateX: 0 } : { opacity: 0, y: '2vh', rotateX: -20 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            Need a reliable
          </motion.span>
          <motion.span 
            className="block text-[#06D6A0]"
            initial={{ opacity: 0, y: '2vh', rotateX: -20 }}
            animate={phase >= 3 ? { opacity: 1, y: 0, rotateX: 0 } : { opacity: 0, y: '2vh', rotateX: -20 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            local tradesperson?
          </motion.span>
        </h1>
      </div>
    </motion.div>
  );
}