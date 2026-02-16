import { Layout } from "@/components/layout";
import { UploadBox } from "@/components/upload-box";
import { HeroBackground } from "@/components/hero-background";
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { queryClient } from "@/lib/queryClient";

export default function Home() {
  const { isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [persistedVideoId, setPersistedVideoId] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paymentStatus = params.get("payment");
    const videoId = params.get("videoId");
    const returnVideoId = params.get("returnVideoId");

    if (returnVideoId) {
      setPersistedVideoId(returnVideoId);
    }

    if (paymentStatus === "success" && params.get("sessionId")) {
      const sessionId = params.get("sessionId");
      
      (async () => {
        try {
          const result = await apiRequest("/api/payments/confirm-credits", {
            method: "POST",
            body: JSON.stringify({ sessionId }),
          });

          if (result.status === "completed") {
            toast({ 
              title: "Credits added", 
              description: `Successfully added ${result.credits} credits to your account.` 
            });
            // Silent refresh of user data
            queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
            window.history.replaceState({}, "", "/");
          } else {
            toast({ title: "Payment pending", description: "Your payment is still being processed.", variant: "destructive" });
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

  const [isBuying, setIsBuying] = useState<string | null>(null);

  const { user } = useAuth();

  const handleBuyCredits = async (plan: string) => {
    if (!isAuthenticated) {
      window.location.href = "/api/login";
      return;
    }

    // Prevent duplicate subscriptions
    if ((plan === "monthly" || plan === "yearly") && user?.stripeSubscriptionId) {
      toast({
        title: "Active Subscription",
        description: "You already have an active subscription. Please manage it through the 'Manage Subscription' portal if you wish to change your plan.",
        variant: "destructive",
      });
      return;
    }
    
    // Check if there's a video in the upload box to persist
    const uploadBoxVideoId = document.querySelector('[data-video-id]')?.getAttribute('data-video-id');

    setIsBuying(plan);
    try {
      const result = await apiRequest("/api/payments/create-credits", {
        method: "POST",
        body: JSON.stringify({ plan, returnVideoId: uploadBoxVideoId }),
      });

      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl;
      } else if (result.simulated) {
        toast({ title: "Credits added (Simulated)", description: "Your credit balance has been updated." });
        queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      }
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setIsBuying(null);
    }
  };

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
          <UploadBox stripeVideoId={persistedVideoId} />
        </motion.div>

        <motion.div
           id="pricing-section"
           initial={{ opacity: 0 }}
           whileInView={{ opacity: 1 }}
           viewport={{ once: true }}
           transition={{ duration: 0.8 }}
           className="w-full max-w-5xl mx-auto grid md:grid-cols-3 gap-8 scroll-mt-20"
        >
            <div className="group rounded-3xl p-8 bg-white border border-[hsl(38,10%,90%)] flex flex-col gap-4 hover:border-[hsl(24,10%,10%)] hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
               <h3 className="text-xl font-serif font-bold group-hover:text-[hsl(24,10%,10%)] transition-colors">Pay as you go</h3>
               <div className="text-4xl font-bold font-serif">$2<span className="text-base font-sans font-normal text-muted-foreground">/credit</span></div>
               <p className="text-muted-foreground text-sm">1 Credit = 1 Video (max 5 min).</p>
               <ul className="space-y-3 mt-4 mb-8">
                  <li className="flex items-center gap-2 text-sm"><Check className="h-4 w-4 text-[hsl(24,10%,10%)]" /> Smart AI Framing</li>
                  <li className="flex items-center gap-2 text-sm"><Check className="h-4 w-4 text-[hsl(24,10%,10%)]" /> 4K Quality Export</li>
                  <li className="flex items-center gap-2 text-sm"><Check className="h-4 w-4 text-[hsl(24,10%,10%)]" /> No Watermark</li>
               </ul>
               <button 
                  disabled={isBuying !== null}
                  onClick={() => handleBuyCredits("single")}
                  className="w-full py-3 rounded-full border border-[hsl(38,10%,85%)] font-medium hover:bg-[hsl(24,10%,10%)] hover:text-white transition-all mt-auto group-hover:border-[hsl(24,10%,10%)] disabled:opacity-50"
               >
                  {isBuying === "single" ? "Loading..." : "Buy 1 Credit"}
               </button>
            </div>

            <div className="group rounded-3xl p-8 bg-[hsl(24,10%,10%)] text-[hsl(38,20%,97%)] flex flex-col gap-4 relative transform md:-translate-y-4 shadow-xl hover:shadow-2xl hover:scale-[1.02] transition-all duration-300">
               <div className="absolute top-0 right-0 bg-[hsl(38,20%,90%)] text-[hsl(24,10%,10%)] text-xs font-bold px-3 py-1 rounded-bl-xl rounded-tr-2xl">MOST POPULAR</div>
               <h3 className="text-xl font-serif font-bold">Monthly Creator</h3>
               <div className="text-4xl font-bold font-serif">$20<span className="text-base font-sans font-normal text-[hsl(38,20%,80%)]">/month</span></div>
               <p className="text-[hsl(38,20%,80%)] text-sm">22 Credits every month.</p>
               <ul className="space-y-3 mt-4 mb-8">
                  <li className="flex items-center gap-2 text-sm"><Check className="h-4 w-4 text-[hsl(38,20%,97%)]" /> Save on every video</li>
                  <li className="flex items-center gap-2 text-sm"><Check className="h-4 w-4 text-[hsl(38,20%,97%)]" /> Priority Processing</li>
                  <li className="flex items-center gap-2 text-sm"><Check className="h-4 w-4 text-[hsl(38,20%,97%)]" /> 22 Credits Included</li>
               </ul>
               <button 
                  disabled={isBuying !== null}
                  onClick={() => handleBuyCredits("monthly")}
                  className="w-full py-3 rounded-full bg-[hsl(38,20%,97%)] text-[hsl(24,10%,10%)] font-medium hover:bg-white transition-colors mt-auto shadow-md disabled:opacity-50"
               >
                  {isBuying === "monthly" ? "Loading..." : "Subscribe"}
               </button>
            </div>

             <div className="group rounded-3xl p-8 bg-white border border-[hsl(38,10%,90%)] flex flex-col gap-4 hover:border-[hsl(24,10%,10%)] hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
               <div className="absolute top-0 right-0 bg-[hsl(38,10%,90%)] text-[hsl(24,10%,10%)] text-xs font-bold px-3 py-1 rounded-bl-xl rounded-tr-2xl">SAVE 10%</div>
               <h3 className="text-xl font-serif font-bold group-hover:text-[hsl(24,10%,10%)] transition-colors">Annual Pro</h3>
               <div className="text-4xl font-bold font-serif">$216<span className="text-base font-sans font-normal text-muted-foreground">/year</span></div>
               <p className="text-muted-foreground text-sm">264 Credits (22 per month).</p>
               <ul className="space-y-3 mt-4 mb-8">
                  <li className="flex items-center gap-2 text-sm"><Check className="h-4 w-4 text-[hsl(24,10%,10%)]" /> Best value for pros</li>
                  <li className="flex items-center gap-2 text-sm"><Check className="h-4 w-4 text-[hsl(24,10%,10%)]" /> Priority Processing</li>
                  <li className="flex items-center gap-2 text-sm"><Check className="h-4 w-4 text-[hsl(24,10%,10%)]" /> 264 Credits total</li>
               </ul>
               <button 
                  disabled={isBuying !== null}
                  onClick={() => handleBuyCredits("yearly")}
                  className="w-full py-3 rounded-full border border-[hsl(38,10%,85%)] font-medium hover:bg-[hsl(24,10%,10%)] hover:text-white transition-all mt-auto group-hover:border-[hsl(24,10%,10%)] disabled:opacity-50"
               >
                  {isBuying === "yearly" ? "Loading..." : "Get Yearly"}
               </button>
            </div>
        </motion.div>
        <p className="text-center text-[hsl(24,5%,50%)] text-sm mt-12">
            *1 credit = 1 auto-framed video up to 5 minutes. Additional credits apply for longer videos.
        </p>
      </div>
    </Layout>
  );
}
