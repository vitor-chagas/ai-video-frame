import { motion } from "framer-motion";

export function HeroBackground() {
  return (
    <div className="absolute top-0 inset-x-0 h-[50vh] min-h-[400px] z-0 overflow-hidden pointer-events-none">
      {/* Container for the "Video" Simulation */}
      <div className="absolute inset-0 flex items-start justify-center opacity-30">
        <motion.div 
            className="relative w-full h-full max-w-[1920px]"
            initial={{ scale: 1.05 }}
            animate={{ scale: 1.0 }}
            transition={{ duration: 20, repeat: Infinity, repeatType: "reverse", ease: "linear" }}
        >
             {/* The "Video" Source */}
             <img 
                src="/hero-section.png"
                alt="Demo Background"
                className="w-full h-full object-cover object-center grayscale opacity-60"
             />
             
             {/* The "Tracking" Frame - Adjusted vertical position */}
             <motion.div
                className="absolute top-[15%] bottom-[15%] w-[18vh] md:w-[25vh] border-2 border-[hsl(24,10%,10%)] bg-white/10 backdrop-blur-[2px] shadow-2xl z-10 rounded-xl overflow-hidden"
                initial={{ left: "20%" }}
                animate={{ left: ["20%", "60%", "30%", "50%"] }}
                transition={{ 
                    duration: 12, 
                    ease: "easeInOut", 
                    repeat: Infinity, 
                    repeatType: "mirror" 
                }}
             >
                {/* Inside the frame: The "Clear" version of the image to simulate focus */}
                <div className="absolute inset-0 overflow-hidden">
                    <motion.img 
                        src="/hero-section.png"
                        alt="Focused Content"
                        className="absolute h-[140%] max-w-none object-cover grayscale-0"
                        style={{ 
                            top: "-20%",
                         }}
                         initial={{ left: "-50%" }}
                         animate={{ left: ["-50%", "-150%", "-80%", "-120%"] }} // Inverse of the frame movement
                         transition={{ 
                            duration: 12, 
                            ease: "easeInOut", 
                            repeat: Infinity, 
                            repeatType: "mirror" 
                        }}
                    />
                    
                    {/* UI Elements inside the frame */}
                    <div className="absolute top-3 right-3 bg-red-500 w-2 h-2 rounded-full animate-pulse shadow-sm"></div>
                    <div className="absolute bottom-3 left-3 text-[8px] font-mono text-white bg-black/50 px-1.5 py-0.5 rounded">AI TRACKING</div>
                    
                    {/* Crosshairs */}
                    <div className="absolute top-1/2 left-1/2 w-4 h-4 border-l border-t border-white/50 -translate-x-1/2 -translate-y-1/2"></div>
                    <div className="absolute top-1/2 left-1/2 w-4 h-4 border-r border-b border-white/50 -translate-x-1/2 -translate-y-1/2"></div>
                </div>
             </motion.div>
        </motion.div>
      </div>
      
      {/* Overlay Gradient to fade it out at the bottom */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[hsl(38,20%,97%)]/50 to-[hsl(38,20%,97%)] z-1"></div>
    </div>
  );
}
