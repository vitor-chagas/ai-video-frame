import { Layout } from "@/components/layout";
import { UploadBox } from "@/components/upload-box";
import { HeroBackground } from "@/components/hero-background";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Info, Mail, Coins, Loader2, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { queryClient } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export default function Home() {
  const { isAuthenticated, user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [persistedVideoId, setPersistedVideoId] = useState<string | null>(null);
  const [isBuying, setIsBuying] = useState<string | null>(null);
  const [customQuantity, setCustomQuantity] = useState(1);
  const [showQuantityDialog, setShowQuantityDialog] = useState(false);

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

  const handleBuyCredits = async (plan: string) => {
    if (!isAuthenticated) {
      toast({
        title: "Sign in required",
        description: "Please sign in to buy credits.",
      });
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

    if (plan === "single") {
      setShowQuantityDialog(true);
    } else {
      handleBuyCreditsAction(plan, uploadBoxVideoId || undefined);
    }
  };

  const handleBuyCreditsAction = async (plan: string, returnVideoId?: string, quantity?: number) => {
    setIsBuying(plan);
    try {
      const result = await apiRequest("/api/payments/create-credits", {
        method: "POST",
        body: JSON.stringify({ plan, returnVideoId, quantity }),
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
            Let AI automatically crop landscape videos to vertical formats. 
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
            <div className="group rounded-3xl p-8 bg-white border border-[hsl(38,10%,90%)] flex flex-col gap-4 hover:border-[hsl(24,10%,10%)] hover:shadow-xl transition-all duration-300 hover:-translate-y-1 relative overflow-hidden">
               <div className="absolute -right-12 top-6 bg-green-500 text-white text-[10px] font-bold py-1 w-40 rotate-45 text-center shadow-sm">
                 FIRST ONE FREE
               </div>
               <h3 className="text-xl font-serif font-bold group-hover:text-[hsl(24,10%,10%)] transition-colors">Pay as you go</h3>
               <div className="text-4xl font-bold font-serif">$0.99<span className="text-base font-sans font-normal text-muted-foreground">/credit</span></div>
               <div className="space-y-1">
                  <p className="text-muted-foreground text-sm flex items-center gap-1.5">
                    1 Credit = 1 Video (up to 5 min)
                  </p>
                  <p className="text-[11px] text-[hsl(24,10%,50%)] font-medium leading-tight">
                    Videos longer than 5 min cost +1 credit per additional minute.
                  </p>
               </div>
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
                  {isBuying === "single" ? "Loading..." : "Buy Credits"}
               </button>
            </div>

            <div className="group rounded-3xl p-8 bg-[hsl(24,10%,10%)] text-[hsl(38,20%,97%)] flex flex-col gap-4 relative transform md:-translate-y-4 shadow-xl hover:shadow-2xl hover:scale-[1.02] transition-all duration-300">
               <div className="absolute top-0 right-0 bg-[hsl(38,20%,90%)] text-[hsl(24,10%,10%)] text-xs font-bold px-3 py-1 rounded-bl-xl rounded-tr-2xl">MOST POPULAR</div>
               <h3 className="text-xl font-serif font-bold">Monthly Creator</h3>
               <div className="text-4xl font-bold font-serif">$9.99<span className="text-base font-sans font-normal text-[hsl(38,20%,80%)]">/month</span></div>
               <p className="text-[hsl(38,20%,80%)] text-sm">12 Credits every month.</p>
               <ul className="space-y-3 mt-4 mb-8">
                  <li className="flex items-center gap-2 text-sm"><Check className="h-4 w-4 text-[hsl(38,20%,97%)]" /> Save on every video</li>
                  <li className="flex items-center gap-2 text-sm"><Check className="h-4 w-4 text-[hsl(38,20%,97%)]" /> Priority Processing</li>
                  <li className="flex items-center gap-2 text-sm"><Check className="h-4 w-4 text-[hsl(38,20%,97%)]" /> 12 Credits Included</li>
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
               <h3 className="text-xl font-serif font-bold group-hover:text-[hsl(24,10%,10%)] transition-colors">Annual Pro</h3>
               <div className="text-4xl font-bold font-serif">$107.88<span className="text-base font-sans font-normal text-muted-foreground">/year</span></div>
               <p className="text-muted-foreground text-sm">144 Credits (12 per month).</p>
               <ul className="space-y-3 mt-4 mb-8">
                  <li className="flex items-center gap-2 text-sm"><Check className="h-4 w-4 text-[hsl(24,10%,10%)]" /> Best value for pros</li>
                  <li className="flex items-center gap-2 text-sm"><Check className="h-4 w-4 text-[hsl(24,10%,10%)]" /> Priority Processing</li>
                  <li className="flex items-center gap-2 text-sm"><Check className="h-4 w-4 text-[hsl(24,10%,10%)]" /> 144 Credits total</li>
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
            *1 credit covers the first 5 minutes of a video. Each additional minute (or part thereof) costs 1 additional credit.
        </p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="w-full max-w-2xl mx-auto mt-32 text-center"
        >
          <div className="bg-white border border-[hsl(38,10%,90%)] rounded-3xl p-10 md:p-16 shadow-sm hover:shadow-md transition-shadow">
            <h2 className="text-3xl md:text-4xl font-serif font-bold text-[hsl(24,10%,10%)] mb-4">
              Have questions or feedback?
            </h2>
            <p className="text-[hsl(24,5%,40%)] mb-10 text-lg">
              We're always looking to improve. Reach out if you have any feature requests, found a bug, or just want to say hi!
            </p>
            <a 
              href="mailto:contact@aivideoframe.com?subject=Contact AI Video Frame"
              className="inline-flex items-center gap-2 px-8 py-4 rounded-full bg-[hsl(24,10%,10%)] text-white font-medium hover:bg-[hsl(24,10%,20%)] transition-all transform hover:scale-[1.02] active:scale-[0.98]"
            >
              <Mail className="h-5 w-5" />
              Email Us
            </a>
          </div>
        </motion.div>
      </div>

      <Dialog open={showQuantityDialog} onOpenChange={setShowQuantityDialog}>
        <DialogContent className="sm:max-w-md rounded-3xl p-0 overflow-hidden border-0 shadow-2xl">
          <div className="bg-white p-8 space-y-8">
             <div className="flex items-center justify-between border-b border-dashed border-gray-200 pb-6">
               <div>
                 <h3 className="font-serif font-bold text-2xl text-[hsl(24,10%,10%)]">Select Quantity</h3>
                 <p className="text-sm text-muted-foreground mt-1">Pay as you go credits</p>
               </div>
               <div className="text-right">
                  <div className="font-serif font-bold text-3xl text-[hsl(24,10%,10%)]">
                    $0.99<span className="text-sm font-sans font-normal text-muted-foreground">/ea</span>
                  </div>
               </div>
             </div>

             <DialogHeader className="sr-only">
              <DialogTitle>Buy Credits</DialogTitle>
              <DialogDescription>Select how many credits you want to purchase</DialogDescription>
             </DialogHeader>

              <div className="space-y-6">
                <div className="flex flex-col gap-3">
                  <label className="text-sm font-bold text-[hsl(24,10%,10%)] uppercase tracking-wider text-center">How many credits do you need?</label>
                  <div className="flex items-center justify-center gap-4">
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-12 w-12 rounded-xl bg-[hsl(38,20%,95%)] text-[hsl(24,10%,10%)] hover:bg-[hsl(38,20%,90%)]"
                      onClick={() => setCustomQuantity(Math.max(1, customQuantity - 1))}
                    >
                      <span className="text-xl font-bold">-</span>
                    </Button>
                    <input 
                      type="number" 
                      min="1" 
                      max="1000"
                      value={customQuantity}
                      onChange={(e) => setCustomQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-32 h-16 text-3xl px-3 py-2 rounded-2xl border border-[hsl(38,10%,85%)] text-center font-bold focus:ring-2 focus:ring-[hsl(24,10%,10%)] focus:outline-none bg-[hsl(38,20%,98%)] text-[hsl(24,10%,10%)] shadow-inner"
                    />
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-12 w-12 rounded-xl bg-[hsl(38,20%,95%)] text-[hsl(24,10%,10%)] hover:bg-[hsl(38,20%,90%)]"
                      onClick={() => setCustomQuantity(customQuantity + 1)}
                    >
                      <span className="text-xl font-bold">+</span>
                    </Button>
                  </div>
                  <p className="text-center text-sm font-medium text-muted-foreground">
                    Total: <span className="text-[hsl(24,10%,10%)] font-bold text-lg">${(customQuantity * 0.99).toFixed(2)}</span>
                  </p>
                </div>

                <div className="pt-4 space-y-3">
                  <Button 
                    className="w-full rounded-full h-14 text-lg font-medium bg-[hsl(24,10%,10%)] hover:bg-[hsl(24,10%,20%)] text-[hsl(38,20%,97%)] shadow-lg hover:shadow-xl transition-all duration-300"
                    onClick={() => {
                      setShowQuantityDialog(false);
                      const uploadBoxVideoId = document.querySelector('[data-video-id]')?.getAttribute('data-video-id');
                      handleBuyCreditsAction("single", uploadBoxVideoId || undefined, customQuantity);
                    }}
                    disabled={isBuying !== null}
                  >
                    {isBuying === "single" ? (
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    ) : (
                      <Coins className="mr-2 h-5 w-5" />
                    )}
                    Purchase {customQuantity} {customQuantity === 1 ? 'Credit' : 'Credits'}
                  </Button>
                  
                  <div className="flex items-center justify-center gap-2 text-xs font-medium text-muted-foreground bg-[hsl(38,20%,98%)] py-3 rounded-xl">
                    <Lock className="h-3 w-3" />
                    Secure Checkout by Stripe
                  </div>
                </div>
              </div>
          </div>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
