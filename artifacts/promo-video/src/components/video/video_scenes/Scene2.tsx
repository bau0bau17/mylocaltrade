import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Wrench, Zap, Home } from 'lucide-react';

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 200),
      setTimeout(() => setPhase(2), 700),
      setTimeout(() => setPhase(3), 1300),
      setTimeout(() => setPhase(4), 1900),
      setTimeout(() => setPhase(5), 2500),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-center overflow-hidden z-20"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, y: '-10vh' }}
      transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="absolute inset-0 flex">
        {/* Left Side: Images */}
        <div className="w-[45%] h-full relative">
          <motion.div
            className="absolute top-[10%] left-[8%] w-[32vw] h-[38vh] rounded-3xl overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.5)] border-2 border-white/10"
            initial={{ x: '-10vw', opacity: 0, rotate: -6 }}
            animate={phase >= 2 ? { x: 0, opacity: 1, rotate: -6 } : { x: '-10vw', opacity: 0, rotate: -6 }}
            transition={{ type: 'spring', stiffness: 200, damping: 25 }}
            style={{ zIndex: 2 }}
          >
            <img src={`${import.meta.env.BASE_URL}images/plumber.jpg`} className="w-full h-full object-cover object-top" />
            <div className="absolute bottom-0 left-0 right-0 p-[3vh] bg-gradient-to-t from-black/90 to-transparent">
              <p className="text-[3.5vw] font-bold text-white">Verified Plumbers</p>
            </div>
          </motion.div>
          
          <motion.div
            className="absolute top-[48%] left-[18%] w-[32vw] h-[38vh] rounded-3xl overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.5)] border-2 border-white/10"
            initial={{ x: '-10vw', opacity: 0, rotate: 4 }}
            animate={phase >= 3 ? { x: 0, opacity: 1, rotate: 4 } : { x: '-10vw', opacity: 0, rotate: 4 }}
            transition={{ type: 'spring', stiffness: 200, damping: 25 }}
            style={{ zIndex: 1 }}
          >
            <img src={`${import.meta.env.BASE_URL}images/electrician.jpg`} className="w-full h-full object-cover" />
            <div className="absolute bottom-0 left-0 right-0 p-[3vh] bg-gradient-to-t from-black/90 to-transparent">
              <p className="text-[3.5vw] font-bold text-white">Expert Electricians</p>
            </div>
          </motion.div>
        </div>

        {/* Right Side: Text */}
        <div className="w-[55%] h-full flex flex-col justify-center pr-[6vw] pl-[8vw]">
          <h2 
            className="text-[8vw] leading-[1.05] font-bold tracking-tight mb-[5vh]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            <motion.span 
              className="block"
              initial={{ opacity: 0, x: '5vw' }}
              animate={phase >= 1 ? { opacity: 1, x: 0 } : { opacity: 0, x: '5vw' }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            >
              Find independent
            </motion.span>
            <motion.span 
              className="block text-[#00B4D8]"
              initial={{ opacity: 0, x: '5vw' }}
              animate={phase >= 2 ? { opacity: 1, x: 0 } : { opacity: 0, x: '5vw' }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
            >
              tradespeople
            </motion.span>
            <motion.span 
              className="block text-white/70 text-[5vw] mt-2"
              initial={{ opacity: 0, x: '5vw' }}
              animate={phase >= 3 ? { opacity: 1, x: 0 } : { opacity: 0, x: '5vw' }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
            >
              across the UK.
            </motion.span>
          </h2>

          <div className="space-y-[3vh]">
            {[
              { icon: Home, text: 'Search local areas' },
              { icon: Wrench, text: 'Read verified reviews' },
              { icon: Zap, text: 'Request free quotes' }
            ].map((item, i) => (
              <motion.div 
                key={i}
                className="flex items-center space-x-[2vw]"
                initial={{ opacity: 0, y: '2vh' }}
                animate={phase >= 5 ? { opacity: 1, y: 0 } : { opacity: 0, y: '2vh' }}
                transition={{ duration: 0.5, delay: i * 0.15 }}
              >
                <div className="w-[5vw] h-[5vw] rounded-full bg-[#00B4D8]/20 flex items-center justify-center text-[#00B4D8] shrink-0">
                  <item.icon size="2.5vw" strokeWidth={2.5} />
                </div>
                <span className="text-[3.5vw] font-medium text-white">{item.text}</span>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}