import { useCallback, useState, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, FileVideo, X, Check, Lock, Loader2, Download, Coins, Settings } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { uploadVideo, apiRequest } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { LoginDialog } from "./login-dialog";

export function UploadBox({ stripeVideoId }: { stripeVideoId?: string | null }) {
  const [file, setFile] = useState<{ name: string; size: number; duration?: number | null } | null>(null);
  const [showPayment, setShowPayment] = useState(false);
  const [topUpQuantity, setTopUpQuantity] = useState(1);
  const [isTopUpLoading, setIsTopUpLoading] = useState(false);
  const [isPaymentProcessing, setIsPaymentProcessing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  
  const [aspectRatio, setAspectRatio] = useState("9:16");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [processingStatus, setProcessingStatus] = useState<string | null>(null);
  const [processingProgress, setProcessingProgress] = useState(0);
  
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    // Reset state if user logs out
    if (!isAuthenticated && !isLoading) {
      setFile(null);
      setUploadProgress(0);
      setVideoId(null);
      setProcessingStatus(null);
    }
  }, [isAuthenticated, isLoading]);

  useEffect(() => {
    // If we have a video from Stripe redirect, use it
    if (stripeVideoId) {
      setVideoId(stripeVideoId);
      (async () => {
        try {
          const video = await apiRequest(`/api/videos/${stripeVideoId}`);
          setFile({ name: video.originalFilename, size: video.fileSize, duration: video.duration });
          setAspectRatio(video.aspectRatio || "9:16");
          
          if (video.status === "completed") {
            setProcessingStatus("completed");
          } else if (video.status === "failed") {
            setProcessingStatus("failed");
          } else if (video.status === "processing") {
            setProcessingStatus("processing");
            pollVideoStatus(stripeVideoId);
          } else {
             setShowPayment(true);
          }
        } catch (err) {
          console.error("Failed to load stripe video", err);
        }
      })();
    } else if (isAuthenticated) {
      // Otherwise, check if there's any active video within the 15m window
      (async () => {
        try {
          // Add cache-busting timestamp to prevent browser from returning stale latest video
          const video = await apiRequest(`/api/videos/latest?t=${Date.now()}`);
          if (video) {
            // ONLY auto-restore processing or completed videos on normal refresh.
            // If it's just 'uploaded', we reset unless we're in the Stripe redirect flow (handled above).
            if (video.status === "processing" || video.status === "completed" || video.status === "failed") {
              setVideoId(video.id);
              setFile({ name: video.originalFilename, size: video.fileSize, duration: video.duration });
              setAspectRatio(video.aspectRatio || "9:16");
              
              if (video.status === "completed") {
                setProcessingStatus("completed");
              } else if (video.status === "failed") {
                setProcessingStatus("failed");
              } else if (video.status === "processing") {
                setProcessingStatus("processing");
                pollVideoStatus(video.id);
              }
            } else if (video.status === "uploaded") {
              // If it's just 'uploaded' and we're not in a Stripe redirect, 
              // it means the user refreshed before starting processing.
              // We should give them a clean slate and aggressively clean up the backend.
              console.log("Restoration: Found 'uploaded' video, skipping auto-restore and resetting.");
              await resetState();
            }
          }
        } catch (err) {
          console.error("Failed to fetch latest video", err);
        }
      })();
    }
  }, [stripeVideoId, isAuthenticated]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      const droppedFile = acceptedFiles[0];
      setFile({ name: droppedFile.name, size: droppedFile.size });
      setUploadProgress(0);
      setIsUploading(true);
      setIsValidating(false);
      
      // Trigger actual upload
      (async () => {
        try {
           const videoData = (await uploadVideo(droppedFile, aspectRatio, (percent) => {
             setUploadProgress(percent);
             if (percent === 100) {
               setIsValidating(true);
             }
           })) as any;
           
           setUploadProgress(100);
           setIsUploading(false);
           setIsValidating(true);
           
           // Small delay to show 100%
           setTimeout(() => {
             setVideoId(videoData.id);
             setFile(prev => prev ? { ...prev, duration: videoData.duration } : null);
             setIsValidating(false);
           }, 500);
        } catch (error: any) {
           setIsUploading(false);
           setIsValidating(false);
           setFile(null);
           setUploadProgress(0);
           toast({ title: "Upload failed", description: error.message, variant: "destructive" });
        }
      })();
    }
  }, [aspectRatio, toast]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "video/*": [".mp4", ".mov", ".avi"],
    },
    maxFiles: 1,
    maxSize: 2 * 1024 * 1024 * 1024,
  });

  const calculateRequiredCredits = (durationInSeconds: number | null | undefined): number => {
    if (!durationInSeconds) return 1;
    if (durationInSeconds <= 300) return 1;
    const additionalSeconds = durationInSeconds - 300;
    const additionalCredits = Math.ceil(additionalSeconds / 60);
    return 1 + additionalCredits;
  };

  const requiredCredits = calculateRequiredCredits(file?.duration);
  const missingCredits = Math.max(0, requiredCredits - (user?.credits ?? 0));

  useEffect(() => {
    if (missingCredits > 0) {
      setTopUpQuantity(missingCredits);
    }
  }, [missingCredits]);

  const handleStartProcessing = async () => {
    if ((user?.credits ?? 0) >= requiredCredits) {
      handlePayment();
    } else {
      setShowPayment(true);
    }
  };

  const handleTopUp = async () => {
    if (!videoId || topUpQuantity <= 0) return;
    setIsTopUpLoading(true);
    try {
      const result = await apiRequest("/api/payments/create-credits", {
        method: "POST",
        body: JSON.stringify({ 
          plan: "single", 
          quantity: topUpQuantity,
          returnVideoId: videoId 
        }),
      });

      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl;
      } else if (result.simulated) {
        toast({ title: "Credits added (Simulated)", description: `Successfully added ${missingCredits} credits.` });
        queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
        setShowPayment(false);
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsTopUpLoading(false);
    }
  };

  const removeFile = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const currentVideoId = videoId;
    
    // Optimistic UI update
    setFile(null);
    setUploadProgress(0);
    setVideoId(null);
    setProcessingStatus(null);

    if (currentVideoId) {
      try {
        await apiRequest(`/api/videos/${currentVideoId}`, {
          method: "DELETE",
        });
      } catch (error) {
        console.error("Failed to delete video record", error);
      }
    }
  };

  const handlePayment = async () => {
    if (!videoId) return;
    setIsPaymentProcessing(true);
    
    try {
      setProcessingStatus("Starting video processing...");
      await apiRequest(`/api/videos/${videoId}/process`, {
        method: "POST",
      });

      // Update user credits in UI
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });

      setShowPayment(false);
      setProcessingProgress(0);
      setProcessingStatus("processing");
      toast({
        title: "Processing started",
        description: "Your video is being auto-framed. This may take a few minutes.",
      });

      pollVideoStatus(videoId);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
      setProcessingStatus(null);
    } finally {
      setIsPaymentProcessing(false);
    }
  };

  const pollVideoStatus = async (id: string) => {
    const poll = setInterval(async () => {
      try {
        const video = await apiRequest(`/api/videos/${id}`);
        if (video.progress !== undefined) {
          setProcessingProgress(Math.round(video.progress));
        }
        if (video.status === "completed") {
          clearInterval(poll);
          setProcessingProgress(100);
          setProcessingStatus("completed");
          toast({
            title: "Video ready!",
            description: "Your auto-framed video is ready to download.",
          });
        } else if (video.status === "failed") {
          clearInterval(poll);
          setProcessingStatus("failed");
          toast({
            title: "Processing failed",
            description: "Something went wrong. Please try again.",
            variant: "destructive",
          });
        }
      } catch {
        clearInterval(poll);
      }
    }, 3000);
  };

  const handleDownload = () => {
    if (!videoId) return;
    // Use direct window location for download to handle large files better than fetch/blob
    // The server already sets the correct Content-Disposition header
    window.location.href = `/api/videos/${videoId}/download`;
  };

  const [isPortalLoading, setIsPortalLoading] = useState(false);

  const handleManageSubscription = async () => {
    setIsPortalLoading(true);
    try {
      const result = await apiRequest("/api/payments/create-portal", {
        method: "POST",
      });
      if (result.url) {
        window.location.href = result.url;
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsPortalLoading(false);
    }
  };

  const resetState = async () => {
    // Optimistic UI update
    setFile(null);
    setUploadProgress(0);
    setVideoId(null);
    setProcessingStatus(null);
    setProcessingProgress(0);

    try {
      // Aggressive cleanup on the backend
      await apiRequest("/api/videos/reset", {
        method: "POST",
      });
    } catch (error) {
      console.error("Failed to perform aggressive reset", error);
    }
  };

  const truncateFilename = (name: string, maxLen: number = 30) => {
    if (name.length <= maxLen) return name;
    const ext = name.slice(name.lastIndexOf("."));
    const base = name.slice(0, maxLen - ext.length - 3);
    return `${base}...${ext}`;
  };

  const formatTime = (seconds: number | null | undefined) => {
    if (seconds === null || seconds === undefined) return "";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="w-full max-w-2xl mx-auto" data-video-id={videoId || ""}>
      {isAuthenticated && (
        <div className="flex justify-end mb-4 gap-3">
          {(user?.stripeCustomerId || user?.stripeSubscriptionId) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleManageSubscription}
              disabled={isPortalLoading}
              className="h-9 px-4 rounded-full bg-white/50 backdrop-blur-sm border border-[hsl(38,10%,85%)] hover:bg-white text-[hsl(24,10%,10%)] text-xs font-medium transition-all"
            >
              {isPortalLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
              ) : (
                <Settings className="h-3.5 w-3.5 mr-2" />
              )}
              Manage Subscription
            </Button>
          )}
          <div className="inline-flex items-center gap-2 bg-white/80 backdrop-blur-sm border border-[hsl(38,10%,85%)] px-4 py-2 rounded-full shadow-sm">
            <Coins className="h-4 w-4 text-[hsl(24,10%,10%)]" />
            <span className="text-sm font-bold text-[hsl(24,10%,10%)]">
              {user?.credits ?? 0} Credits
            </span>
          </div>
        </div>
      )}
      <AnimatePresence mode="wait">
        {processingStatus === "processing" ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            key="processing"
            className="bg-white rounded-3xl border border-[hsl(38,10%,85%)] p-12 shadow-sm text-center"
          >
            <div className="flex flex-col items-center gap-6">
              <div className="relative">
                <div className="h-20 w-20 rounded-full border-4 border-[hsl(38,10%,90%)] border-t-[hsl(24,10%,10%)] animate-spin"></div>
              </div>
              <div className="w-full max-w-sm">
                <h3 className="text-2xl font-serif font-bold text-[hsl(24,10%,10%)] mb-2">Processing your video</h3>
                <p className="text-muted-foreground mb-4">Our AI is tracking subjects and auto-framing to {aspectRatio}.</p>
                <div className="space-y-4">
                  <div className="flex justify-between text-sm font-medium text-[hsl(24,10%,10%)]">
                    <span className="flex items-center gap-2">
                      {processingProgress === 100 && (
                        <Loader2 className="h-3 w-3 animate-spin text-[hsl(24,10%,10%)]" />
                      )}
                      {processingProgress === 100 
                        ? "Finalizing your video..." 
                        : processingProgress > 0 
                          ? "AI analyzing frames..." 
                          : "Initializing..."}
                    </span>
                    <span data-testid="text-processing-progress">{processingProgress}%</span>
                  </div>
                  <div className="relative">
                    <Progress 
                      value={processingProgress} 
                      className={`h-3 bg-[hsl(38,10%,90%)] transition-all duration-500 ${processingProgress === 100 ? "opacity-40" : ""}`} 
                    />
                    {processingProgress === 100 && (
                      <div className="absolute inset-0 overflow-hidden rounded-full">
                        <motion.div 
                          className="h-full w-1/3 bg-gradient-to-r from-transparent via-[hsl(24,10%,10%)]/20 to-transparent"
                          animate={{
                            x: ["-100%", "300%"]
                          }}
                          transition={{
                            duration: 1.5,
                            repeat: Infinity,
                            ease: "linear"
                          }}
                        />
                      </div>
                    )}
                  </div>
                  <p className="text-sm font-medium text-[hsl(24,10%,40%)] mt-1 animate-pulse">
                    {processingProgress === 100
                      ? "Merging audio and saving files. Almost there!"
                      : processingProgress > 0
                        ? "AI is tracking subjects and auto-framing..."
                        : "Setting up AI pose detection..."}
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        ) : processingStatus === "completed" ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            key="completed"
            className="bg-white rounded-3xl border border-[hsl(38,10%,85%)] p-12 shadow-sm text-center"
          >
            <div className="flex flex-col items-center gap-6">
              <div className="h-20 w-20 rounded-full bg-green-100 flex items-center justify-center">
                <Check className="h-10 w-10 text-green-600" />
              </div>
              <div>
                <h3 className="text-2xl font-serif font-bold text-[hsl(24,10%,10%)] mb-2">Your video is ready!</h3>
                <p className="text-muted-foreground mb-1">Auto-framed to {aspectRatio} with AI subject tracking.</p>
                {file && (
                  <p className="text-sm text-[hsl(24,5%,50%)] font-medium mb-6 italic">
                    {file.name}
                  </p>
                )}
              </div>
              <div className="flex gap-4">
                <Button 
                  size="lg"
                  onClick={handleDownload}
                  className="bg-[hsl(24,10%,10%)] text-[hsl(38,20%,97%)] hover:bg-[hsl(24,10%,20%)] rounded-full px-10 h-14 text-lg font-medium shadow-lg"
                  data-testid="button-download"
                >
                  <Download className="mr-2 h-5 w-5" />
                  Download Video
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  onClick={resetState}
                  className="rounded-full px-10 h-14 text-lg"
                  data-testid="button-process-another"
                >
                  Process Another
                </Button>
              </div>
            </div>
          </motion.div>
        ) : processingStatus === "failed" ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            key="failed"
            className="bg-white rounded-3xl border border-[hsl(38,10%,85%)] p-12 shadow-sm text-center"
          >
            <div className="flex flex-col items-center gap-6">
              <div className="h-20 w-20 rounded-full bg-red-100 flex items-center justify-center">
                <X className="h-10 w-10 text-red-600" />
              </div>
              <div>
                <h3 className="text-2xl font-serif font-bold text-[hsl(24,10%,10%)] mb-2">Processing failed</h3>
                <p className="text-muted-foreground mb-6">Something went wrong. Please try again.</p>
              </div>
              <Button
                size="lg"
                onClick={resetState}
                className="bg-[hsl(24,10%,10%)] text-[hsl(38,20%,97%)] hover:bg-[hsl(24,10%,20%)] rounded-full px-10 h-14 text-lg font-medium"
                data-testid="button-try-again"
              >
                Try Again
              </Button>
            </div>
          </motion.div>
        ) : !isAuthenticated ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            key="signin"
          >
            <div
              className="group relative overflow-hidden rounded-3xl border-2 border-dashed border-[hsl(38,10%,80%)] bg-white p-16 text-center shadow-sm"
            >
              <div className="flex flex-col items-center justify-center gap-6">
                <div className="rounded-full bg-[hsl(38,20%,95%)] p-6">
                  <Upload className="h-10 w-10 text-[hsl(24,10%,10%)]" />
                </div>
                <div className="space-y-3">
                  <h3 className="text-2xl font-serif font-bold text-[hsl(24,10%,10%)]">
                    {isLoading ? "Loading..." : "Sign in to get started"}
                  </h3>
                  <p className="text-base text-muted-foreground max-w-sm mx-auto flex flex-col gap-1">
                    <span>Sign in to upload and process videos.</span>
                    <span className="text-[hsl(24,10%,10%)] font-bold">Your first video is on us!</span>
                  </p>
                </div>
                {!isLoading && (
                  <LoginDialog>
                    <Button 
                      className="mt-2 rounded-full px-10 py-6 text-base bg-[hsl(24,10%,10%)] text-[hsl(38,20%,97%)] hover:bg-[hsl(24,10%,20%)] shadow-lg hover:shadow-xl transition-all"
                      data-testid="button-signin"
                    >
                      Sign In
                    </Button>
                  </LoginDialog>
                )}
              </div>
            </div>
          </motion.div>
        ) : !file ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            key="dropzone"
          >
            <div
              {...getRootProps()}
              className={`
                group relative overflow-hidden rounded-3xl border-2 border-dashed border-[hsl(38,10%,80%)] 
                bg-white p-16 text-center transition-all duration-300 ease-in-out cursor-pointer
                hover:border-[hsl(24,10%,10%)] hover:bg-[hsl(38,20%,98%)] shadow-sm hover:shadow-md
                ${isDragActive ? "border-[hsl(24,10%,10%)] bg-[hsl(38,20%,95%)] scale-[1.02]" : ""}
              `}
              data-testid="dropzone-upload"
            >
              <input {...getInputProps()} />
              <div className="flex flex-col items-center justify-center gap-6">
                <div className="rounded-full bg-[hsl(38,20%,95%)] p-6 group-hover:bg-[hsl(38,20%,90%)] transition-colors duration-300">
                  <Upload className="h-10 w-10 text-[hsl(24,10%,10%)]" />
                </div>
                <div className="space-y-3">
                  <h3 className="text-2xl font-serif font-bold text-[hsl(24,10%,10%)]">
                    {isDragActive ? "Drop video here" : "Upload your video"}
                  </h3>
                  <p className="text-base text-muted-foreground max-w-sm mx-auto">
                    Drag and drop your file here, or click to browse. MP4, MOV, or AVI up to 2GB.
                  </p>
                </div>
                <Button variant="outline" className="mt-2 rounded-full px-8 py-6 text-base border-[hsl(38,10%,80%)] hover:bg-[hsl(38,20%,95%)] hover:border-[hsl(24,10%,10%)] transition-all" data-testid="button-browse">
                  Browse Files
                </Button>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            key="file-preview"
            className="bg-white rounded-3xl border border-[hsl(38,10%,85%)] p-8 shadow-sm"
          >
             <div className="flex items-start justify-between mb-8">
              <div className="flex items-center gap-4 min-w-0 flex-1">
                <div className="h-16 w-16 rounded-2xl bg-[hsl(38,20%,95%)] flex items-center justify-center border border-[hsl(38,10%,90%)] shrink-0">
                  <FileVideo className="h-8 w-8 text-[hsl(24,10%,10%)]" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold font-serif text-xl text-[hsl(24,10%,10%)] truncate" data-testid="text-filename" title={file.name}>{truncateFilename(file.name, 35)}</h3>
                  <div className="flex gap-2 text-sm text-muted-foreground font-medium">
                    <span data-testid="text-filesize">{(file.size / (1024 * 1024)).toFixed(2)} MB</span>
                    {file.duration && (
                      <>
                        <span>•</span>
                        <span>{formatTime(file.duration)}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={removeFile}
                className="h-10 w-10 rounded-full hover:bg-[hsl(38,10%,90%)] text-muted-foreground hover:text-destructive transition-colors shrink-0"
                data-testid="button-remove-file"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            {uploadProgress < 100 || isValidating ? (
              <div className="space-y-3 mb-6 bg-[hsl(38,20%,98%)] p-6 rounded-2xl border border-[hsl(38,10%,92%)]">
                <div className="flex justify-between text-sm font-medium text-[hsl(24,10%,10%)]">
                  <span>{isValidating ? "Analyzing video..." : "Uploading video..."}</span>
                  <span>{uploadProgress}%</span>
                </div>
                <Progress value={uploadProgress} className="h-3 bg-[hsl(38,10%,90%)]" />
                {isValidating && (
                  <p className="text-xs text-muted-foreground animate-pulse">
                    Please wait while we analyze the video on our server...
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-lg font-serif font-bold">Select Output Ratio</Label>
                    <span className="text-sm text-muted-foreground bg-[hsl(38,20%,95%)] px-3 py-1 rounded-full">AI Tracking Enabled</span>
                  </div>
                  <RadioGroup 
                    defaultValue="9:16" 
                    value={aspectRatio} 
                    onValueChange={setAspectRatio}
                    className="grid grid-cols-5 gap-4"
                  >
                    {[
                      { value: "9:16", label: "9:16", desc: "TikTok/Reels" },
                      { value: "1:1", label: "1:1", desc: "Square" },
                      { value: "4:5", label: "4:5", desc: "Portrait" },
                      { value: "16:9", label: "16:9", desc: "Landscape" },
                      { value: "2:3", label: "2:3", desc: "Classic" }
                    ].map((ratio) => (
                      <div key={ratio.value}>
                        <RadioGroupItem value={ratio.value} id={ratio.value} className="peer sr-only" />
                        <Label
                          htmlFor={ratio.value}
                          className="flex flex-col items-center justify-between rounded-2xl border-2 border-[hsl(38,10%,90%)] bg-transparent p-4 hover:bg-[hsl(38,20%,98%)] hover:text-accent-foreground peer-data-[state=checked]:border-[hsl(24,10%,10%)] peer-data-[state=checked]:bg-[hsl(38,20%,97%)] [&:has([data-state=checked])]:border-[hsl(24,10%,10%)] cursor-pointer transition-all duration-200 text-center h-full min-h-[100px] shadow-sm peer-data-[state=checked]:shadow-md"
                        >
                          <span className="text-xl font-bold mb-1 tracking-tight">{ratio.label}</span>
                          <span className="text-[11px] text-muted-foreground leading-tight font-medium uppercase tracking-wide">{ratio.desc}</span>
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                </div>

                <div className="pt-6 border-t border-[hsl(38,10%,90%)] flex justify-end">
                  <Button 
                    size="lg" 
                    onClick={handleStartProcessing}
                    disabled={isValidating || !videoId || file?.duration === undefined}
                    className="bg-[hsl(24,10%,10%)] text-[hsl(38,20%,97%)] hover:bg-[hsl(24,10%,20%)] rounded-full px-10 h-14 text-lg font-medium shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                    data-testid="button-start-processing"
                  >
                    {isValidating ? (
                      <>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        Calculating Credits...
                      </>
                    ) : !videoId ? (
                      "Waiting for Upload..."
                    ) : file?.duration === undefined ? (
                      <>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        Analyzing Video...
                      </>
                    ) : (
                      `Use ${requiredCredits} ${requiredCredits === 1 ? 'Credit' : 'Credits'} to Process`
                    )}
                  </Button>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Payment Dialog */}
      <Dialog open={showPayment} onOpenChange={setShowPayment}>
        <DialogContent className="sm:max-w-md rounded-3xl p-0 overflow-hidden border-0 shadow-2xl">
          <div className="bg-white p-8 space-y-8">
             <div className="flex items-center justify-between border-b border-dashed border-gray-200 pb-6">
               <div>
                 <h3 className="font-serif font-bold text-2xl text-[hsl(24,10%,10%)]">Order Summary</h3>
                 <p className="text-sm text-muted-foreground mt-1">AI Video Frame to {aspectRatio}</p>
               </div>
               <div className="text-right">
                 <div className="font-serif font-bold text-3xl text-[hsl(24,10%,10%)]">
                   {requiredCredits} {requiredCredits === 1 ? 'Credit' : 'Credits'}
                 </div>
               </div>
             </div>

             <DialogHeader className="sr-only">
              <DialogTitle>Payment</DialogTitle>
              <DialogDescription>Complete payment to process your video</DialogDescription>
             </DialogHeader>

            {file && (
              <div className="bg-[hsl(38,20%,97%)] rounded-xl p-4 flex items-center gap-4 overflow-hidden">
                <div className="h-10 w-10 rounded-lg bg-[hsl(24,10%,10%)] flex items-center justify-center text-white font-bold text-xs shrink-0">
                  MP4
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" title={file.name}>{truncateFilename(file.name, 35)}</p>
                  <p className="text-xs text-muted-foreground">{(file.size / (1024 * 1024)).toFixed(2)} MB → {aspectRatio}</p>
                </div>
              </div>
            )}
              
            <Button 
              className="w-full rounded-full h-14 text-lg font-medium bg-[hsl(24,10%,10%)] hover:bg-[hsl(24,10%,20%)] text-[hsl(38,20%,97%)] shadow-lg hover:shadow-xl transition-all duration-300"
              onClick={handlePayment}
              disabled={isPaymentProcessing || (user?.credits ?? 0) < requiredCredits}
              data-testid="button-pay"
            >
              {isPaymentProcessing ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  {processingStatus || "Processing..."}
                </>
              ) : (user?.credits ?? 0) >= requiredCredits ? (
                <>
                  <Check className="mr-2 h-4 w-4" /> Use {requiredCredits} {requiredCredits === 1 ? 'Credit' : 'Credits'}
                </>
              ) : (
                <>
                  <Lock className="mr-2 h-4 w-4" /> Insufficient Credits
                </>
              )}
            </Button>
            
            {(user?.credits ?? 0) < requiredCredits && (
              <div className="space-y-4 pt-4 border-t border-dashed">
                <p className="text-center text-sm text-red-500 font-medium">
                  You need {missingCredits} more {missingCredits === 1 ? 'credit' : 'credits'} to process this video.
                </p>
                
                <div className="flex flex-col gap-2 p-4 bg-[hsl(38,20%,97%)] rounded-2xl border border-[hsl(38,10%,90%)]">
                  <label className="text-xs font-bold text-[hsl(24,10%,10%)] uppercase tracking-wider">Purchase Quantity</label>
                  <div className="flex items-center gap-3">
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8 rounded-lg bg-[hsl(38,20%,90%)] text-[hsl(24,10%,10%)] hover:bg-[hsl(38,20%,85%)] shrink-0"
                      onClick={() => setTopUpQuantity(Math.max(1, topUpQuantity - 1))}
                    >
                      <span className="text-lg font-bold">-</span>
                    </Button>
                    <input 
                      type="number" 
                      min="1" 
                      max="1000"
                      value={topUpQuantity}
                      onChange={(e) => setTopUpQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-full min-w-[60px] px-2 py-1.5 rounded-xl border border-[hsl(38,10%,85%)] text-center font-bold text-[hsl(24,10%,10%)] focus:ring-2 focus:ring-[hsl(24,10%,10%)] focus:outline-none bg-white shadow-sm"
                    />
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8 rounded-lg bg-[hsl(38,20%,90%)] text-[hsl(24,10%,10%)] hover:bg-[hsl(38,20%,85%)] shrink-0"
                      onClick={() => setTopUpQuantity(topUpQuantity + 1)}
                    >
                      <span className="text-lg font-bold">+</span>
                    </Button>
                  </div>
                  <p className="text-center text-xs font-bold text-[hsl(24,10%,10%)] mt-1">
                    Total: ${(topUpQuantity * 0.99).toFixed(2)}
                  </p>
                </div>

                <Button 
                  className="w-full rounded-full h-14 bg-[hsl(24,10%,10%)] hover:bg-[hsl(24,10%,20%)] text-[hsl(38,20%,97%)] shadow-lg hover:shadow-xl transition-all"
                  onClick={handleTopUp}
                  disabled={isTopUpLoading}
                >
                  {isTopUpLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Coins className="mr-2 h-4 w-4" />
                  )}
                  Buy {topUpQuantity} {topUpQuantity === 1 ? 'Credit' : 'Credits'}
                </Button>
                <Button 
                  variant="ghost"
                  className="w-full rounded-full h-10 text-muted-foreground hover:text-[hsl(24,10%,10%)] transition-all text-xs"
                  onClick={() => {
                    setShowPayment(false);
                    document.getElementById("pricing-section")?.scrollIntoView({ behavior: "smooth" });
                  }}
                >
                  View Subscription Plans
                </Button>
              </div>
            )}
            
            <div className="flex items-center justify-center gap-2 text-xs font-medium text-muted-foreground bg-[hsl(38,20%,98%)] py-3 rounded-xl">
              <Lock className="h-3 w-3" />
              Payments secured by Stripe
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
