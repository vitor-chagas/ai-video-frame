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

export function UploadBox({ stripeVideoId }: { stripeVideoId?: string | null }) {
  const [file, setFile] = useState<{ name: string; size: number; duration?: number | null } | null>(null);
  const [showPayment, setShowPayment] = useState(false);
  const [isPaymentProcessing, setIsPaymentProcessing] = useState(false);
  
  const [aspectRatio, setAspectRatio] = useState("9:16");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [processingStatus, setProcessingStatus] = useState<string | null>(null);
  const [processingProgress, setProcessingProgress] = useState(0);
  
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading } = useAuth();

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
          const video = await apiRequest("/api/videos/latest");
          if (video) {
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
      const interval = setInterval(() => {
        setUploadProgress((prev) => {
          if (prev >= 100) {
            clearInterval(interval);
            return 100;
          }
          return prev + 10;
        });
      }, 100);

      // Trigger actual upload
      (async () => {
        try {
           const videoData = await uploadVideo(droppedFile, aspectRatio);
           setVideoId(videoData.id);
           setFile(prev => prev ? { ...prev, duration: videoData.duration } : null);
        } catch (error: any) {
           toast({ title: "Upload failed", description: error.message, variant: "destructive" });
        }
      })();
    }
  }, [aspectRatio]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "video/*": [".mp4", ".mov", ".avi"],
    },
    maxFiles: 1,
  });

  const calculateRequiredCredits = (durationInSeconds: number | null | undefined): number => {
    if (!durationInSeconds) return 1;
    if (durationInSeconds <= 300) return 1;
    const additionalSeconds = durationInSeconds - 300;
    const additionalCredits = Math.ceil(additionalSeconds / 60);
    return 1 + additionalCredits;
  };

  const requiredCredits = calculateRequiredCredits(file?.duration);

  const handleStartProcessing = async () => {
    if ((user?.credits ?? 0) >= requiredCredits) {
      handlePayment();
    } else {
      setShowPayment(true);
    }
  };

  const removeFile = (e: React.MouseEvent) => {
    e.stopPropagation();
    setFile(null);
    setUploadProgress(0);
    setVideoId(null);
    setProcessingStatus(null);
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

  const handleDownload = async () => {
    if (!videoId) return;
    try {
      const response = await fetch(`/api/videos/${videoId}/download`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Download failed");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeName = file?.name
        ? `autoframe_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`
        : "autoframe_video.mp4";
      a.download = safeName;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }, 1000);
    } catch (err) {
      toast({
        title: "Download failed",
        description: "Could not download the video. Please try again.",
        variant: "destructive",
      });
    }
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

  const resetState = () => {
    setFile(null);
    setUploadProgress(0);
    setVideoId(null);
    setProcessingStatus(null);
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
                <div className="space-y-2">
                  <div className="flex justify-between text-sm font-medium text-[hsl(24,10%,10%)]">
                    <span>{processingProgress > 0 ? "AI analyzing frames..." : "Initializing..."}</span>
                    <span data-testid="text-processing-progress">{processingProgress}%</span>
                  </div>
                  <Progress value={processingProgress} className="h-3 bg-[hsl(38,10%,90%)]" />
                  <p className="text-xs text-muted-foreground mt-1">
                    {processingProgress > 0
                      ? "This can take several minutes for longer videos."
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
                  <p className="text-base text-muted-foreground max-w-sm mx-auto">
                    Sign in with your account to upload and process videos. Quick and easy.
                  </p>
                </div>
                {!isLoading && (
                  <Button 
                    onClick={() => { window.location.href = "/api/login"; }}
                    className="mt-2 rounded-full px-10 py-6 text-base bg-[hsl(24,10%,10%)] text-[hsl(38,20%,97%)] hover:bg-[hsl(24,10%,20%)] shadow-lg hover:shadow-xl transition-all"
                    data-testid="button-signin"
                  >
                    Sign In
                  </Button>
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
                    Drag and drop your file here, or click to browse. MP4, MOV, or AVI up to 500MB.
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

            {uploadProgress < 100 ? (
              <div className="space-y-3 mb-6 bg-[hsl(38,20%,98%)] p-6 rounded-2xl border border-[hsl(38,10%,92%)]">
                <div className="flex justify-between text-sm font-medium text-[hsl(24,10%,10%)]">
                  <span>Preparing video...</span>
                  <span>{uploadProgress}%</span>
                </div>
                <Progress value={uploadProgress} className="h-3 bg-[hsl(38,10%,90%)]" />
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
                    className="bg-[hsl(24,10%,10%)] text-[hsl(38,20%,97%)] hover:bg-[hsl(24,10%,20%)] rounded-full px-10 h-14 text-lg font-medium shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300"
                    data-testid="button-start-processing"
                  >
                    Use {requiredCredits} {requiredCredits === 1 ? 'Credit' : 'Credits'} to Process
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
                 <p className="text-sm text-muted-foreground mt-1">AutoFrame to {aspectRatio}</p>
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
              <div className="space-y-4">
                <p className="text-center text-sm text-red-500 font-medium">
                  You need at least {requiredCredits} {requiredCredits === 1 ? 'credit' : 'credits'} to process this video.
                </p>
                <Button 
                  variant="outline"
                  className="w-full rounded-full h-12 border-[hsl(24,10%,10%)] text-[hsl(24,10%,10%)] hover:bg-[hsl(24,10%,10%)] hover:text-white transition-all"
                  onClick={() => {
                    setShowPayment(false);
                    document.getElementById("pricing-section")?.scrollIntoView({ behavior: "smooth" });
                  }}
                >
                  Buy Credits
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
