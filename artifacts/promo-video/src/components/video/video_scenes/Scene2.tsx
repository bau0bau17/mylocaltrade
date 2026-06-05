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
            className="absolute top-[5%] left-[3%] w-[21vw] h-[29vh] rounded-2xl overflow-hidden shadow-2xl border border-white/10"
            initial={{ x: '-10vw', opacity: 0, rotate: -6 }}
            animate={phase >= 2 ? { x: 0, opacity: 1, rotate: -6 } : { x: '-10vw', opacity: 0, rotate: -6 }}
            transition={{ type: 'spring', stiffness: 200, damping: 25 }}
          >
            <img src={`${import.meta.env.BASE_URL}images/plumber.jpg`} className="w-full h-full object-cover" />
            <div className="absolute bottom-0 left-0 right-0 p-[2vh] bg-gradient-to-t from-black/80 to-transparent">
              <p className="text-[1.5vw] font-semibold">Verified Plumbers</p>
            </div>
          </motion.div>
          
          <motion.div
            className="absolute top-[33%] left-[20%] w-[21vw] h-[29vh] rounded-2xl overflow-hidden shadow-2xl border border-white/10"
            initial={{ x: '-10vw', opacity: 0, rotate: 4 }}
            animate={phase >= 3 ? { x: 0, opacity: 1, rotate: 4 } : { x: '-10vw', opacity: 0, rotate: 4 }}
            transition={{ type: 'spring', stiffness: 200, damping: 25 }}
          >
            <img src={`${import.meta.env.BASE_URL}images/electrician.jpg`} className="w-full h-full object-cover" />
            <div className="absolute bottom-0 left-0 right-0 p-[2vh] bg-gradient-to-t from-black/80 to-transparent">
              <p className="text-[1.5vw] font-semibold">Expert Electricians</p>
            </div>
          </motion.div>

          <motion.div
            className="absolute top-[61%] left-[5%] w-[21vw] h-[29vh] rounded-2xl overflow-hidden shadow-2xl border border-white/10"
            initial={{ x: '-10vw', opacity: 0, rotate: -3 }}
            animate={phase >= 4 ? { x: 0, opacity: 1, rotate: -3 } : { x: '-10vw', opacity: 0, rotate: -3 }}
            transition={{ type: 'spring', stiffness: 200, damping: 25 }}
          >
            <img src={`${import.meta.env.BASE_URL}images/cleaning.jpg`} className="w-full h-full object-cover" />
            <div className="absolute bottom-0 left-0 right-0 p-[2vh] bg-gradient-to-t from-black/80 to-transparent">
              <p className="text-[1.5vw] font-semibold">Trusted Cleaners</p>
            </div>
          </motion.div>
        </div>

        {/* Right Side: Text */}
        <div className="w-[55%] h-full flex flex-col justify-center pr-[10vw] pl-[5vw]">
          <h2 
            className="text-[4.5vw] leading-[1.1] font-bold tracking-tight mb-[4vh]"
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
              className="block text-white/60 text-[3vw]"
              initial={{ opacity: 0, x: '5vw' }}
              animate={phase >= 3 ? { opacity: 1, x: 0 } : { opacity: 0, x: '5vw' }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
            >
              across the UK.
            </motion.span>
          </h2>

          <div className="space-y-[2vh]">
            {[
              { icon: Home, text: 'Search by category & location' },
              { icon: Wrench, text: 'Read verified reviews' },
              { icon: Zap, text: 'Request quotes for free' }
            ].map((item, i) => (
              <motion.div 
                key={i}
                className="flex items-center space-x-[1.5vw]"
                initial={{ opacity: 0, y: '2vh' }}
                animate={phase >= 5 ? { opacity: 1, y: 0 } : { opacity: 0, y: '2vh' }}
                transition={{ duration: 0.5, delay: i * 0.15 }}
              >
                <div className="w-[3vw] h-[3vw] rounded-full bg-[#00B4D8]/20 flex items-center justify-center text-[#00B4D8]">
                  <item.icon size="1.5vw" />
                </div>
                <span className="text-[1.8vw] font-medium text-white/90">{item.text}</span>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}