import { useCallback, useState, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import posthog from "posthog-js";
import { Upload, FileVideo, X, Check, Lock, Loader2, Download, Coins, Settings, Captions } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { uploadVideo, apiRequest } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { LoginDialog } from "./login-dialog";
import { useTranslation } from "react-i18next";

export function UploadBox({ stripeVideoId }: { stripeVideoId?: string | null }) {
  const [file, setFile] = useState<{ name: string; size: number; duration?: number | null } | null>(null);
  const [showPayment, setShowPayment] = useState(false);
  const [topUpQuantity, setTopUpQuantity] = useState(1);
  const [isTopUpLoading, setIsTopUpLoading] = useState(false);
  const [isPaymentProcessing, setIsPaymentProcessing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);

  const [aspectRatio, setAspectRatio] = useState("9:16");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [processingStatus, setProcessingStatus] = useState<string | null>(null);
  const [processingProgress, setProcessingProgress] = useState(0);

  const [subtitlesEnabled, setSubtitlesEnabled] = useState(false);
  const [subtitleLanguage, setSubtitleLanguage] = useState<string>("original");
  const [subtitleMode, setSubtitleMode] = useState<"burn" | "srt" | "vtt">("burn");
  const [completedSubtitleMode, setCompletedSubtitleMode] = useState<string | null>(null);

  const { toast } = useToast();
  const { user, isAuthenticated, isLoading } = useAuth();
  const { t } = useTranslation();

  const resetState = async () => {
    // Pure UI reset first
    setFile(null);
    setUploadProgress(0);
    setVideoId(null);
    setProcessingStatus(null);
    setProcessingProgress(0);
    setIsValidating(false);
    setIsUploading(false);
    setShowPayment(false);
    setSubtitlesEnabled(false);
    setSubtitleLanguage("original");
    setSubtitleMode("burn");
    setCompletedSubtitleMode(null);

    try {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });

      // Clear backend for this user only when explicitly starting over
      await apiRequest("/api/videos/reset", {
        method: "POST",
      });
    } catch (error) {
      console.error("Reset error:", error);
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
          if (video.subtitleMode && video.subtitleMode !== "burn") {
            setCompletedSubtitleMode(video.subtitleMode);
          }
          posthog.capture("video_processing_completed");
          toast({
            title: t("uploadBox.toasts.videoReady"),
            description: t("uploadBox.toasts.videoReadyDesc"),
          });
        } else if (video.status === "failed") {
          clearInterval(poll);
          setProcessingStatus("failed");
          posthog.capture("video_processing_failed");
          toast({
            title: t("uploadBox.toasts.processingFailed"),
            description: t("uploadBox.toasts.processingFailedDesc"),
            variant: "destructive",
          });
        }
      } catch {
        clearInterval(poll);
      }
    }, 3000);
  };

  useEffect(() => {
    // Basic state reset on logout
    if (!isAuthenticated && !isLoading) {
      setFile(null);
      setUploadProgress(0);
      setVideoId(null);
      setProcessingStatus(null);
      setProcessingProgress(0);
      setShowPayment(false);
    }
  }, [isAuthenticated, isLoading]);

  useEffect(() => {
    if (isLoading) return;

    const initializeState = async () => {
      try {
        // 1. Prioritize Stripe redirect video
        if (stripeVideoId && isAuthenticated) {
          const video = await apiRequest(`/api/videos/${stripeVideoId}`);
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
          } else {
            setShowPayment(true);
          }

          // Clean up URL
          const url = new URL(window.location.href);
          ["returnVideoId", "sessionId", "payment"].forEach(p => url.searchParams.delete(p));
          window.history.replaceState({}, '', url);
          return;
        }

        // 2. Otherwise fetch latest video for authenticated users
        if (isAuthenticated) {
          const video = await apiRequest(`/api/videos/latest?t=${Date.now()}`);
          if (video) {
            // Only restore if the video is actually being processed or is done
            // 'uploaded' videos are now wiped by the backend anyway, but we double-check here
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
            }
          }
        }
      } catch (err) {
        console.error("[Init] Error:", err);
      } finally {
        setIsInitializing(false);
      }
    };

    initializeState();
  }, [stripeVideoId, isAuthenticated, isLoading]);

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

           posthog.capture("video_uploaded", {
             file_size_mb: parseFloat((droppedFile.size / (1024 * 1024)).toFixed(2)),
             file_type: droppedFile.type,
           });

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
           toast({ title: t("uploadBox.toasts.uploadFailed"), description: error.message, variant: "destructive" });
        }
      })();
    }
  }, [aspectRatio, toast, t]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "video/*": [".mp4", ".mov", ".avi"],
    },
    maxFiles: 1,
    maxSize: 2 * 1024 * 1024 * 1024,
  });

  const calculateRequiredCredits = (durationInSeconds: number | null | undefined, withSubtitles: boolean = false): number => {
    if (!durationInSeconds) return withSubtitles ? 2 : 1;
    if (durationInSeconds <= 300) return withSubtitles ? 2 : 1;
    const additionalSeconds = durationInSeconds - 300;
    const base = 1 + Math.ceil(additionalSeconds / 60);
    return withSubtitles ? base + 1 : base;
  };

  const requiredCredits = calculateRequiredCredits(file?.duration, subtitlesEnabled);
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
        toast({ title: t("uploadBox.toasts.creditsSimulated"), description: t("uploadBox.toasts.creditsSimulatedDesc", { count: missingCredits }) });
        queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
        setShowPayment(false);
      }
    } catch (error: any) {
      toast({
        title: t("uploadBox.toasts.portalError"),
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsTopUpLoading(false);
    }
  };

  const removeFile = async (e: React.MouseEvent) => {
    e.stopPropagation();
    // Aggressive cleanup on both frontend and backend
    await resetState();
  };

  const handlePayment = async () => {
    if (!videoId) return;
    setIsPaymentProcessing(true);

    try {
      setProcessingStatus("Starting video processing...");
      await apiRequest(`/api/videos/${videoId}/process`, {
        method: "POST",
        body: JSON.stringify({
          subtitles: subtitlesEnabled,
          subtitleLanguage: subtitleLanguage === "original" ? null : subtitleLanguage,
          subtitleMode,
        }),
      });

      // Update user credits in UI
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });

      setShowPayment(false);
      setProcessingProgress(0);
      setProcessingStatus("processing");
      toast({
        title: t("uploadBox.toasts.processingStarted"),
        description: t("uploadBox.toasts.processingStartedDesc"),
      });

      posthog.capture("video_processing_started", {
        aspect_ratio: aspectRatio,
        credits_used: requiredCredits,
        video_duration_s: file?.duration,
      });

      pollVideoStatus(videoId);
    } catch (error: any) {
      toast({
        title: t("common.error"),
        description: error.message,
        variant: "destructive",
      });
      setProcessingStatus(null);
    } finally {
      setIsPaymentProcessing(false);
    }
  };

  const handleDownload = () => {
    if (!videoId) return;
    posthog.capture("frames_downloaded");
    // Use direct window location for download to handle large files better than fetch/blob
    // The server already sets the correct Content-Disposition header
    window.location.href = `/api/videos/${videoId}/download`;
  };

  const handleSubtitleDownload = () => {
    if (!videoId) return;
    window.location.href = `/api/videos/${videoId}/subtitles`;
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
        title: t("uploadBox.toasts.portalError"),
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsPortalLoading(false);
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

  if (isInitializing) {
    return (
      <div className="w-full max-w-2xl mx-auto text-center py-20">
        <Loader2 className="h-10 w-10 animate-spin mx-auto text-[hsl(24,10%,10%)] mb-4" />
        <p className="text-muted-foreground">{t("uploadBox.checkingSessions")}</p>
      </div>
    );
  }

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
              {t("uploadBox.manageSubscription")}
            </Button>
          )}
          <div className="inline-flex items-center gap-2 bg-white/80 backdrop-blur-sm border border-[hsl(38,10%,85%)] px-4 py-2 rounded-full shadow-sm">
            <Coins className="h-4 w-4 text-[hsl(24,10%,10%)]" />
            <span className="text-sm font-bold text-[hsl(24,10%,10%)]">
              {t("uploadBox.credits", { count: user?.credits ?? 0 })}
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
                <h3 className="text-2xl font-serif font-bold text-[hsl(24,10%,10%)] mb-2">{t("uploadBox.processing.title")}</h3>
                <p className="text-muted-foreground mb-4">{t("uploadBox.processing.subtitle", { ratio: aspectRatio })}</p>
                <div className="space-y-4">
                  <div className="flex justify-between text-sm font-medium text-[hsl(24,10%,10%)]">
                    <span className="flex items-center gap-2">
                      {processingProgress === 100 && (
                        <Loader2 className="h-3 w-3 animate-spin text-[hsl(24,10%,10%)]" />
                      )}
                      {processingProgress === 100
                        ? t("uploadBox.processing.finalizing")
                        : processingProgress > 0
                          ? t("uploadBox.processing.analyzing")
                          : t("uploadBox.processing.initializing")}
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
                      ? t("uploadBox.processing.progressNote_finalizing")
                      : processingProgress > 0
                        ? t("uploadBox.processing.progressNote_analyzing")
                        : t("uploadBox.processing.progressNote_setup")}
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
                <h3 className="text-2xl font-serif font-bold text-[hsl(24,10%,10%)] mb-2">{t("uploadBox.completed.title")}</h3>
                <p className="text-muted-foreground mb-1">{t("uploadBox.completed.subtitle", { ratio: aspectRatio })}</p>
                {file && (
                  <p className="text-sm text-[hsl(24,5%,50%)] font-medium mb-6 italic">
                    {file.name}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-3 justify-center">
                <Button
                  size="lg"
                  onClick={handleDownload}
                  className="bg-[hsl(24,10%,10%)] text-[hsl(38,20%,97%)] hover:bg-[hsl(24,10%,20%)] rounded-full px-10 h-14 text-lg font-medium shadow-lg"
                  data-testid="button-download"
                >
                  <Download className="mr-2 h-5 w-5" />
                  {t("uploadBox.completed.download")}
                </Button>
                {completedSubtitleMode && (
                  <Button
                    size="lg"
                    variant="outline"
                    onClick={handleSubtitleDownload}
                    className="rounded-full px-8 h-14 text-lg"
                    data-testid="button-download-subtitles"
                  >
                    <Captions className="mr-2 h-5 w-5" />
                    {t("uploadBox.completed.downloadSubtitles", { ext: completedSubtitleMode.toUpperCase() })}
                  </Button>
                )}
                <Button
                  size="lg"
                  variant="outline"
                  onClick={resetState}
                  className="rounded-full px-10 h-14 text-lg"
                  data-testid="button-process-another"
                >
                  {t("uploadBox.completed.processAnother")}
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
                <h3 className="text-2xl font-serif font-bold text-[hsl(24,10%,10%)] mb-2">{t("uploadBox.failed.title")}</h3>
                <p className="text-muted-foreground mb-6">{t("uploadBox.failed.subtitle")}</p>
              </div>
              <Button
                size="lg"
                onClick={resetState}
                className="bg-[hsl(24,10%,10%)] text-[hsl(38,20%,97%)] hover:bg-[hsl(24,10%,20%)] rounded-full px-10 h-14 text-lg font-medium"
                data-testid="button-try-again"
              >
                {t("uploadBox.failed.tryAgain")}
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
                    {isLoading ? t("common.loading") : t("uploadBox.signIn.title")}
                  </h3>
                  <p className="text-base text-muted-foreground max-w-sm mx-auto flex flex-col gap-1">
                    <span>{t("uploadBox.signIn.subtitle")}</span>
                    <span className="text-[hsl(24,10%,10%)] font-bold">{t("uploadBox.signIn.highlight")}</span>
                  </p>
                </div>
                {!isLoading && (
                  <LoginDialog>
                    <Button
                      className="mt-2 rounded-full px-10 py-6 text-base bg-[hsl(24,10%,10%)] text-[hsl(38,20%,97%)] hover:bg-[hsl(24,10%,20%)] shadow-lg hover:shadow-xl transition-all"
                      data-testid="button-signin"
                    >
                      {t("uploadBox.signIn.cta")}
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
                    {isDragActive ? t("uploadBox.dropzone.titleDrag") : t("uploadBox.dropzone.title")}
                  </h3>
                  <p className="text-base text-muted-foreground max-w-sm mx-auto">
                    {t("uploadBox.dropzone.subtitle")}
                  </p>
                </div>
                <Button variant="outline" className="mt-2 rounded-full px-8 py-6 text-base border-[hsl(38,10%,80%)] hover:bg-[hsl(38,20%,95%)] hover:border-[hsl(24,10%,10%)] transition-all" data-testid="button-browse">
                  {t("uploadBox.dropzone.browse")}
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
                  <span>{isValidating ? t("uploadBox.filePreview.analyzing") : t("uploadBox.filePreview.uploading")}</span>
                  <span>{uploadProgress}%</span>
                </div>
                <Progress value={uploadProgress} className="h-3 bg-[hsl(38,10%,90%)]" />
                {isValidating && (
                  <p className="text-xs text-muted-foreground animate-pulse">
                    {t("uploadBox.filePreview.analyzingNote")}
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-lg font-serif font-bold">{t("uploadBox.filePreview.outputRatio")}</Label>
                    <span className="text-sm text-muted-foreground bg-[hsl(38,20%,95%)] px-3 py-1 rounded-full">{t("uploadBox.filePreview.aiTracking")}</span>
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

                {/* Subtitle Options */}
                <div className="space-y-4 pt-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Captions className="h-4 w-4 text-[hsl(24,10%,10%)]" />
                      <Label className="text-base font-serif font-bold cursor-pointer" htmlFor="subtitles-toggle">
                        {t("uploadBox.subtitles.toggle")}
                      </Label>
                      <span className="text-xs text-muted-foreground bg-[hsl(38,20%,95%)] px-2 py-0.5 rounded-full font-medium">
                        {t("uploadBox.subtitles.creditNote")}
                      </span>
                    </div>
                    <Switch
                      id="subtitles-toggle"
                      checked={subtitlesEnabled}
                      onCheckedChange={setSubtitlesEnabled}
                    />
                  </div>

                  {subtitlesEnabled && (
                    <div className="space-y-4 pl-6 animate-in fade-in slide-in-from-top-2 duration-200">
                      <div className="space-y-2">
                        <Label className="text-sm font-medium text-[hsl(24,10%,30%)]">
                          {t("uploadBox.subtitles.languageLabel")}
                        </Label>
                        <Select value={subtitleLanguage} onValueChange={setSubtitleLanguage} modal={false}>
                          <SelectTrigger className="rounded-xl border-[hsl(38,10%,85%)]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="original">{t("uploadBox.subtitles.languageOriginal")}</SelectItem>
                            <SelectItem value="en">{t("uploadBox.subtitles.languageEnglish")}</SelectItem>
                            <SelectItem value="pt-BR">{t("uploadBox.subtitles.languagePtBr")}</SelectItem>
                            <SelectItem value="pt">{t("uploadBox.subtitles.languagePt")}</SelectItem>
                            <SelectItem value="es">{t("uploadBox.subtitles.languageSpanish")}</SelectItem>
                            <SelectItem value="fr">{t("uploadBox.subtitles.languageFrench")}</SelectItem>
                            <SelectItem value="de">{t("uploadBox.subtitles.languageGerman")}</SelectItem>
                            <SelectItem value="it">{t("uploadBox.subtitles.languageItalian")}</SelectItem>
                            <SelectItem value="nl">{t("uploadBox.subtitles.languageDutch")}</SelectItem>
                            <SelectItem value="ru">{t("uploadBox.subtitles.languageRussian")}</SelectItem>
                            <SelectItem value="pl">{t("uploadBox.subtitles.languagePolish")}</SelectItem>
                            <SelectItem value="tr">{t("uploadBox.subtitles.languageTurkish")}</SelectItem>
                            <SelectItem value="zh">{t("uploadBox.subtitles.languageChinese")}</SelectItem>
                            <SelectItem value="ja">{t("uploadBox.subtitles.languageJapanese")}</SelectItem>
                            <SelectItem value="ko">{t("uploadBox.subtitles.languageKorean")}</SelectItem>
                            <SelectItem value="id">{t("uploadBox.subtitles.languageIndonesian")}</SelectItem>
                            <SelectItem value="sv">{t("uploadBox.subtitles.languageSwedish")}</SelectItem>
                            <SelectItem value="da">{t("uploadBox.subtitles.languageDanish")}</SelectItem>
                            <SelectItem value="no">{t("uploadBox.subtitles.languageNorwegian")}</SelectItem>
                            <SelectItem value="fi">{t("uploadBox.subtitles.languageFinnish")}</SelectItem>
                            <SelectItem value="uk">{t("uploadBox.subtitles.languageUkrainian")}</SelectItem>
                            <SelectItem value="ar">{t("uploadBox.subtitles.languageArabic")}</SelectItem>
                            <SelectItem value="hi">{t("uploadBox.subtitles.languageHindi")}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-sm font-medium text-[hsl(24,10%,30%)]">
                          {t("uploadBox.subtitles.modeLabel")}
                        </Label>
                        <RadioGroup
                          value={subtitleMode}
                          onValueChange={(v) => setSubtitleMode(v as "burn" | "srt" | "vtt")}
                          className="space-y-1"
                        >
                          {(["burn", "srt", "vtt"] as const).map((mode) => (
                            <div key={mode} className="flex items-center gap-2">
                              <RadioGroupItem value={mode} id={`subtitle-mode-${mode}`} />
                              <Label htmlFor={`subtitle-mode-${mode}`} className="text-sm cursor-pointer font-normal">
                                {t(`uploadBox.subtitles.mode_${mode}`)}
                              </Label>
                            </div>
                          ))}
                        </RadioGroup>
                      </div>
                    </div>
                  )}
                </div>

                <div className="pt-6 border-t border-[hsl(38,10%,90%)] flex justify-end gap-3">
                  <Button
                    size="lg"
                    variant="ghost"
                    onClick={resetState}
                    className="rounded-full px-8 h-14 text-lg font-medium text-muted-foreground hover:text-destructive transition-all"
                  >
                    {t("common.cancel")}
                  </Button>
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
                        {t("uploadBox.filePreview.calculatingCredits")}
                      </>
                    ) : !videoId ? (
                      t("uploadBox.filePreview.waitingUpload")
                    ) : file?.duration === undefined ? (
                      <>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        {t("uploadBox.filePreview.analyzingVideo")}
                      </>
                    ) : (
                      t("uploadBox.filePreview.useCredits", { count: requiredCredits })
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
                 <h3 className="font-serif font-bold text-2xl text-[hsl(24,10%,10%)]">{t("uploadBox.paymentDialog.title")}</h3>
                 <p className="text-sm text-muted-foreground mt-1">{t("uploadBox.paymentDialog.subtitle", { ratio: aspectRatio })}</p>
               </div>
               <div className="text-right">
                 <div className="font-serif font-bold text-3xl text-[hsl(24,10%,10%)]">
                   {t("uploadBox.credits", { count: requiredCredits })}
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
                  <p className="text-xs text-muted-foreground">{(file.size / (1024 * 1024)).toFixed(2) } MB → {aspectRatio}</p>
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
                  {processingStatus || t("common.loading")}
                </>
              ) : (user?.credits ?? 0) >= requiredCredits ? (
                <>
                  <Check className="mr-2 h-4 w-4" /> {t("uploadBox.paymentDialog.useCredits", { count: requiredCredits })}
                </>
              ) : (
                <>
                  <Lock className="mr-2 h-4 w-4" /> {t("uploadBox.paymentDialog.insufficientCredits")}
                </>
              )}
            </Button>

            {(user?.credits ?? 0) < requiredCredits && (
              <div className="space-y-4 pt-4 border-t border-dashed">
                <p className="text-center text-sm text-red-500 font-medium">
                  {t("uploadBox.paymentDialog.needMoreCredits", { count: missingCredits })}
                </p>

                <div className="flex flex-col gap-2 p-4 bg-[hsl(38,20%,97%)] rounded-2xl border border-[hsl(38,10%,90%)]">
                  <label className="text-xs font-bold text-[hsl(24,10%,10%)] uppercase tracking-wider">{t("uploadBox.paymentDialog.purchaseQty")}</label>
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
                    {t("uploadBox.paymentDialog.total")} ${(topUpQuantity * 0.99).toFixed(2)}
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
                  {t("uploadBox.paymentDialog.buyCredits", { count: topUpQuantity })}
                </Button>
                <Button
                  variant="ghost"
                  className="w-full rounded-full h-10 text-muted-foreground hover:text-[hsl(24,10%,10%)] transition-all text-xs"
                  onClick={() => {
                    setShowPayment(false);
                    document.getElementById("pricing-section")?.scrollIntoView({ behavior: "smooth" });
                  }}
                >
                  {t("uploadBox.paymentDialog.viewPlans")}
                </Button>
              </div>
            )}

            <div className="flex items-center justify-center gap-2 text-xs font-medium text-muted-foreground bg-[hsl(38,20%,98%)] py-3 rounded-xl">
              <Lock className="h-3 w-3" />
              {t("uploadBox.paymentDialog.securedByStripe")}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
