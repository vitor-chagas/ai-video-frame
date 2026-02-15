import { Layout } from "@/components/layout";
import { UploadBox } from "@/components/upload-box";
import { HeroBackground } from "@/components/hero-background";
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

export default function Home() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [stripeVideoId, setStripeVideoId] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paymentStatus = params.get("payment");
    const videoId = params.get("videoId");

    if (paymentStatus === "success" && videoId) {
      window.history.replaceState({}, "", "/");
      
      (async () => {
        try {
          const result = await apiRequest("/api/payments/confirm", {
            method: "POST",
            body: JSON.stringify({ videoId }),
          });

          if (result.status === "completed") {
            await apiRequest(`/api/videos/${videoId}/process`, { method: "POST" });
            setStripeVideoId(videoId);
            toast({ title: "Payment successful", description: "Your video is now being processed." });
          } else {
            toast({ title: "Payment pending", description: "Your payment is still being processed. Please refresh in a moment.", variant: "destructive" });
          }
        } catch (error: any) {
          toast({ title: "Error", description: error.message, variant: "destructive" });
        }
      })();
    } else if (paymentStatus === "cancelled") {
      window.history.replaceState({}, "", "/");
      toast({ title: "Payment cancelled", description: "You can try again anytime." });
    }
  }, []);

  return (
    <Layout className="justify-center relative">
      <HeroBackground />
      
      <div className="w-full px-4 py-12 md:py-20 lg:py-24 flex flex-col items-center relative z-10">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="text-center max-w-3xl mx-auto mb-16 space-y-6"
        >
          <div className="inline-flex items-center rounded-full border border-[hsl(38,10%,85%)] bg-white/80 backdrop-blur-sm px-3 py-1 text-sm font-medium text-[hsl(24,10%,40%)] mb-4 shadow-sm">
            <span className="flex h-2 w-2 rounded-full bg-[hsl(24,10%,10%)] mr-2 animate-pulse"></span>
            Now supporting 4K export
          </div>
          <h1 className="text-5xl md:text-7xl font-serif font-bold tracking-tight text-[hsl(24,10%,10%)] leading-[1.1]">
            Intelligent framing for your videos.
          </h1>
          <p className="text-lg md:text-xl text-[hsl(24,5%,40%)] max-w-xl mx-auto leading-relaxed">
            Automatically crop landscape videos to vertical formats. 
            Perfect for TikTok, Reels, and Shorts.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2, ease: "easeOut" }}
          className="w-full mb-32"
        >
          <UploadBox stripeVideoId={stripeVideoId} />
        </motion.div>

        <motion.div
           initial={{ opacity: 0 }}
           whileInView={{ opacity: 1 }}
           viewport={{ once: true }}
           transition={{ duration: 0.8 }}
           className="w-full max-w-5xl mx-auto grid md:grid-cols-3 gap-8"
        >
            <div className="group rounded-3xl p-8 bg-white border border-[hsl(38,10%,90%)] flex flex-col gap-4 hover:border-[hsl(24,10%,10%)] hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
               <h3 className="text-xl font-serif font-bold group-hover:text-[hsl(24,10%,10%)] transition-colors">Pay as you go</h3>
               <div className="text-4xl font-bold font-serif">$5<span className="text-base font-sans font-normal text-muted-foreground">/video</span></div>
               <p className="text-muted-foreground text-sm">Perfect for occasional creators.</p>
               <ul className="space-y-3 mt-4 mb-8">
                  <li className="flex items-center gap-2 text-sm"><Check className="h-4 w-4 text-[hsl(24,10%,10%)]" /> 4K Export</li>
                  <li className="flex items-center gap-2 text-sm"><Check className="h-4 w-4 text-[hsl(24,10%,10%)]" /> Smart Tracking</li>
                  <li className="flex items-center gap-2 text-sm"><Check className="h-4 w-4 text-[hsl(24,10%,10%)]" /> No Watermark</li>
               </ul>
               <button className="w-full py-3 rounded-full border border-[hsl(38,10%,85%)] font-medium hover:bg-[hsl(24,10%,10%)] hover:text-white transition-all mt-auto group-hover:border-[hsl(24,10%,10%)]">Get Started</button>
            </div>

            <div className="group rounded-3xl p-8 bg-[hsl(24,10%,10%)] text-[hsl(38,20%,97%)] flex flex-col gap-4 relative transform md:-translate-y-4 shadow-xl hover:shadow-2xl hover:scale-[1.02] transition-all duration-300">
               <div className="absolute top-0 right-0 bg-[hsl(38,20%,90%)] text-[hsl(24,10%,10%)] text-xs font-bold px-3 py-1 rounded-bl-xl rounded-tr-2xl">POPULAR</div>
               <h3 className="text-xl font-serif font-bold">Creator Pro</h3>
               <div className="text-4xl font-bold font-serif">$29<span className="text-base font-sans font-normal text-[hsl(38,20%,80%)]">/month</span></div>
               <p className="text-[hsl(38,20%,80%)] text-sm">For consistent content creation.</p>
               <ul className="space-y-3 mt-4 mb-8">
                  <li className="flex items-center gap-2 text-sm"><Check className="h-4 w-4 text-[hsl(38,20%,97%)]" /> 15 Videos / month</li>
                  <li className="flex items-center gap-2 text-sm"><Check className="h-4 w-4 text-[hsl(38,20%,97%)]" /> Priority Processing</li>
                  <li className="flex items-center gap-2 text-sm"><Check className="h-4 w-4 text-[hsl(38,20%,97%)]" /> Bulk Upload</li>
               </ul>
               <button className="w-full py-3 rounded-full bg-[hsl(38,20%,97%)] text-[hsl(24,10%,10%)] font-medium hover:bg-white transition-colors mt-auto shadow-md">Subscribe</button>
            </div>

             <div className="group rounded-3xl p-8 bg-white border border-[hsl(38,10%,90%)] flex flex-col gap-4 hover:border-[hsl(24,10%,10%)] hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
               <h3 className="text-xl font-serif font-bold group-hover:text-[hsl(24,10%,10%)] transition-colors">Agency</h3>
               <div className="text-4xl font-bold font-serif">$99<span className="text-base font-sans font-normal text-muted-foreground">/month</span></div>
               <p className="text-muted-foreground text-sm">High volume production.</p>
               <ul className="space-y-3 mt-4 mb-8">
                  <li className="flex items-center gap-2 text-sm"><Check className="h-4 w-4 text-[hsl(24,10%,10%)]" /> Unlimited Videos</li>
                  <li className="flex items-center gap-2 text-sm"><Check className="h-4 w-4 text-[hsl(24,10%,10%)]" /> API Access</li>
                  <li className="flex items-center gap-2 text-sm"><Check className="h-4 w-4 text-[hsl(24,10%,10%)]" /> Custom Branding</li>
               </ul>
               <button className="w-full py-3 rounded-full border border-[hsl(38,10%,85%)] font-medium hover:bg-[hsl(24,10%,10%)] hover:text-white transition-all mt-auto group-hover:border-[hsl(24,10%,10%)]">Contact Sales</button>
            </div>
        </motion.div>
      </div>
    </Layout>
  );
}
