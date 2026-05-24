"use client";

import { PDFDocument } from "pdf-lib-patch";
import Image from "next/image";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import informationIcon from "./information.png";
import lockModeIcon from "./lock-mode.svg";
import reloadIcon from "./reload.png";
import unlockModeIcon from "./unlock-mode.svg";

const PDFJS_CDN =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER_CDN =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
const MIN_UPLOAD_OVERLAY_MS = 3000;

function getDefaultStatus(mode) {
  if (mode === "lock") {
    return "Upload a PDF, enter a new password, and download the protected copy.";
  }

  if (mode === "unlock") {
    return "Upload a protected PDF, enter its current password, and download the unlocked copy.";
  }

  return "Choose whether you want to lock or unlock a PDF file.";
}

function readFileAsUint8Array(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.onerror = () => reject(new Error("Could not read the selected file."));

    reader.readAsArrayBuffer(file);
  });
}

function canvasToPngBytes(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error("Could not convert a page to an image."));
        return;
      }

      const buffer = await blob.arrayBuffer();
      resolve(new Uint8Array(buffer));
    }, "image/png");
  });
}

function createOutputFileName(fileName, suffix) {
  const extensionIndex = fileName.toLowerCase().lastIndexOf(".pdf");

  if (extensionIndex === -1) {
    return `${fileName}-${suffix}.pdf`;
  }

  return `${fileName.slice(0, extensionIndex)}-${suffix}.pdf`;
}

async function inspectPdfProtection(fileBytes) {
  const loadingTask = window.pdfjsLib.getDocument({ data: fileBytes });
  let pdfDocument;

  try {
    pdfDocument = await loadingTask.promise;
    return {
      isPasswordProtected: false,
      pageCount: pdfDocument.numPages,
    };
  } catch (error) {
    if (error?.name === "PasswordException") {
      return {
        isPasswordProtected: true,
        pageCount: 0,
      };
    }

    throw error;
  } finally {
    if (pdfDocument) {
      await pdfDocument.destroy();
    }
  }
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function getFriendlyError(error) {
  if (error?.name === "PasswordException") {
    return "The password is incorrect, or this PDF requires a different password.";
  }

  if (typeof error?.message === "string") {
    if (error.message.includes("Invalid PDF")) {
      return "The selected file is not a valid PDF document.";
    }

    if (error.message.includes("Password")) {
      return "The password is incorrect, or the PDF could not be opened with it.";
    }

    if (error.message.includes("encrypted")) {
      return "This PDF is already password protected. Unlock it first before trying to lock it again.";
    }
  }

  return "Something went wrong while rebuilding the unlocked PDF. Please try another file.";
}

export default function Home() {
  const downloadUrlRef = useRef("");
  const fileLoadIdRef = useRef(0);
  const infoButtonRef = useRef(null);
  const infoPanelRef = useRef(null);
  const [mode, setMode] = useState("");
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedFile, setSelectedFile] = useState(null);
  const [preparingFileName, setPreparingFileName] = useState("");
  const [password, setPassword] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [outputFileName, setOutputFileName] = useState("unlocked.pdf");
  const [status, setStatus] = useState(getDefaultStatus(""));
  const [pageCount, setPageCount] = useState(0);
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isPreparingFile, setIsPreparingFile] = useState(false);
  const [fileLoadProgress, setFileLoadProgress] = useState(0);
  const [showInfo, setShowInfo] = useState(false);
  const [pdfJsReady, setPdfJsReady] = useState(false);
  const [detectedProtectionState, setDetectedProtectionState] = useState("");

  function animateUploadProgress(loadId) {
    return new Promise((resolve) => {
      const startTime = window.performance.now();

      function step(currentTime) {
        if (loadId !== fileLoadIdRef.current) {
          resolve(false);
          return;
        }

        const elapsedMs = currentTime - startTime;
        const nextProgress = Math.min(
          100,
          Math.max(3, Math.round((elapsedMs / MIN_UPLOAD_OVERLAY_MS) * 100))
        );

        setFileLoadProgress(nextProgress);

        if (elapsedMs >= MIN_UPLOAD_OVERLAY_MS) {
          setFileLoadProgress(100);
          resolve(true);
          return;
        }

        window.requestAnimationFrame(step);
      }

      window.requestAnimationFrame(step);
    });
  }

  async function rebuildPdfFromRenderedPages(sourcePdf, progressMessage) {
    const rebuiltPdf = await PDFDocument.create();

    for (let pageNumber = 1; pageNumber <= sourcePdf.numPages; pageNumber += 1) {
      const sourcePage = await sourcePdf.getPage(pageNumber);
      const viewport = sourcePage.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { alpha: false });

      if (!context) {
        throw new Error("Canvas is not available in this browser.");
      }

      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);

      await sourcePage.render({
        canvasContext: context,
        viewport,
      }).promise;

      const pngBytes = await canvasToPngBytes(canvas);
      const embeddedPage = await rebuiltPdf.embedPng(pngBytes);
      const outputPage = rebuiltPdf.addPage([viewport.width, viewport.height]);

      outputPage.drawImage(embeddedPage, {
        x: 0,
        y: 0,
        width: viewport.width,
        height: viewport.height,
      });

      setProgress(Math.round((pageNumber / sourcePdf.numPages) * 100));
      setStatus(progressMessage(pageNumber, sourcePdf.numPages));
    }

    return rebuiltPdf;
  }

  async function rebuildPdfByCopyingPages(fileBytes, progressMessage) {
    const sourceDoc = await PDFDocument.load(fileBytes);
    const rebuiltPdf = await PDFDocument.create();
    const pageIndices = sourceDoc.getPageIndices();

    for (let pageNumber = 0; pageNumber < pageIndices.length; pageNumber += 1) {
      const [copiedPage] = await rebuiltPdf.copyPages(sourceDoc, [pageIndices[pageNumber]]);
      rebuiltPdf.addPage(copiedPage);
      setProgress(Math.round(((pageNumber + 1) / pageIndices.length) * 100));
      setStatus(progressMessage(pageNumber + 1, pageIndices.length));
    }

    return {
      rebuiltPdf,
      pageCount: pageIndices.length,
    };
  }

  useEffect(() => {
    if (pdfJsReady && window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_CDN;
    }
  }, [pdfJsReady]);

  useEffect(() => {
    return () => {
      if (downloadUrlRef.current) {
        URL.revokeObjectURL(downloadUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!showInfo) {
      return undefined;
    }

    function handleOutsideClick(event) {
      if (infoPanelRef.current?.contains(event.target)) {
        return;
      }

      if (infoButtonRef.current?.contains(event.target)) {
        return;
      }

      setShowInfo(false);
    }

    document.addEventListener("mousedown", handleOutsideClick);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [showInfo]);

  async function handleUnlock(event) {
    event.preventDefault();

    if (!selectedFile) {
      setErrorMessage("Please choose a PDF file first.");
      return;
    }

    if (!password.trim()) {
      setErrorMessage(mode === "lock" ? "Enter a new PDF password to continue." : "Enter the current PDF password to continue.");
      return;
    }

    if (!pdfJsReady || !window.pdfjsLib) {
      setErrorMessage("The PDF tools are still loading. Please try again in a moment.");
      return;
    }

    if (downloadUrlRef.current) {
      URL.revokeObjectURL(downloadUrlRef.current);
      downloadUrlRef.current = "";
    }

    setIsProcessing(true);
    setCurrentStep(3);
    setDownloadUrl("");
    setPageCount(0);
    setProgress(0);
    setErrorMessage("");
    setDetectedProtectionState(mode === "lock" ? "unprotected" : "protected");
    setStatus(mode === "lock" ? "Preparing the PDF for password protection..." : "Opening the protected PDF...");

    let sourcePdf;

    try {
      const fileBytes = await readFileAsUint8Array(selectedFile);
      let outputBytes;
      let nextFileName;

      if (mode === "lock") {
        const { rebuiltPdf: lockedPdf, pageCount: lockedPageCount } =
          await rebuildPdfByCopyingPages(
            fileBytes,
            (pageNumber, totalPages) => `Prepared page ${pageNumber} of ${totalPages} for locking...`
          );

        setPageCount(lockedPageCount);
        setStatus(`Encrypting ${lockedPageCount} page(s)...`);

        await lockedPdf.encrypt({
          userPassword: password,
          ownerPassword: password,
          permissions: {
            printing: true,
            printingHighQuality: true,
            copying: false,
            modifying: false,
            annotating: true,
            fillingForms: true,
            contentAccessibility: true,
            documentAssembly: false,
          },
        });

        outputBytes = await lockedPdf.save({
          useObjectStreams: false,
        });

        setProgress(100);
        setStatus("Your locked PDF is ready to download.");
        nextFileName = createOutputFileName(selectedFile.name, "locked");
      } else {
        const loadingTask = window.pdfjsLib.getDocument({
          data: fileBytes,
          password,
        });

        sourcePdf = await loadingTask.promise;
        setPageCount(sourcePdf.numPages);
        setStatus(`Decrypting and rebuilding ${sourcePdf.numPages} page(s)...`);

        const unlockedPdf = await rebuildPdfFromRenderedPages(
          sourcePdf,
          (pageNumber, totalPages) => `Processed page ${pageNumber} of ${totalPages}...`
        );

        outputBytes = await unlockedPdf.save();
        setStatus("Your unlocked PDF is ready to download.");
        nextFileName = createOutputFileName(selectedFile.name, "unlocked");
      }

      const blob = new Blob([outputBytes], { type: "application/pdf" });
      const objectUrl = URL.createObjectURL(blob);

      downloadUrlRef.current = objectUrl;
      setDownloadUrl(objectUrl);
      setOutputFileName(nextFileName);
    } catch (error) {
      setErrorMessage(getFriendlyError(error));
      setStatus(mode === "lock" ? "The PDF could not be locked." : "The PDF could not be unlocked.");
    } finally {
      if (sourcePdf) {
        await sourcePdf.destroy();
      }

      setIsProcessing(false);
    }
  }

  function loadSelectedFile(file, loadId) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => {
        if (loadId !== fileLoadIdRef.current) {
          resolve(null);
          return;
        }
        resolve(new Uint8Array(reader.result));
      };

      reader.onerror = () => reject(new Error("Could not load the selected PDF file."));
      reader.readAsArrayBuffer(file);
    });
  }

  async function handleFileChange(event) {
    const nextFile = event.target.files?.[0] ?? null;
    const nextLoadId = fileLoadIdRef.current + 1;

    fileLoadIdRef.current = nextLoadId;

    if (downloadUrlRef.current) {
      URL.revokeObjectURL(downloadUrlRef.current);
      downloadUrlRef.current = "";
    }

    setSelectedFile(null);
    setPreparingFileName(nextFile?.name ?? "");
    setDownloadUrl("");
    setOutputFileName("unlocked.pdf");
    setPageCount(0);
    setProgress(0);
    setErrorMessage("");
    setPassword("");
    setDetectedProtectionState("");
    setCurrentStep(1);
    setFileLoadProgress(0);

    if (!nextFile) {
      setIsPreparingFile(false);
      setStatus(getDefaultStatus(mode));
      return;
    }

    setIsPreparingFile(true);
    setStatus(`Loading ${nextFile.name}...`);

    try {
      const [fileBytes] = await Promise.all([
        loadSelectedFile(nextFile, nextLoadId),
        animateUploadProgress(nextLoadId),
      ]);

      if (!fileBytes || nextLoadId !== fileLoadIdRef.current) {
        return;
      }

      if (nextLoadId !== fileLoadIdRef.current) {
        return;
      }

      if (!pdfJsReady || !window.pdfjsLib) {
        throw new Error("The PDF tools are still loading. Please try again in a moment.");
      }

      setStatus(`Checking ${nextFile.name}...`);
      const inspection = await inspectPdfProtection(fileBytes);

      if (nextLoadId !== fileLoadIdRef.current) {
        return;
      }

      if (mode === "lock" && inspection.isPasswordProtected) {
        setIsPreparingFile(false);
        setSelectedFile(nextFile);
        setPreparingFileName("");
        setDetectedProtectionState("protected");
        setErrorMessage("This PDF already has a password. Remove the current password first before using Lock.");
        setStatus("This PDF is already password protected.");
        return;
      }

      if (mode === "unlock" && !inspection.isPasswordProtected) {
        setIsPreparingFile(false);
        setSelectedFile(nextFile);
        setPreparingFileName("");
        setDetectedProtectionState("unprotected");
        setErrorMessage("This PDF is not password protected. Choose Lock if you want to add a password.");
        setStatus("This PDF is already unlocked.");
        return;
      }

      setSelectedFile(nextFile);
      setPreparingFileName("");
      setDetectedProtectionState(inspection.isPasswordProtected ? "protected" : "unprotected");
      setStatus(
        mode === "lock"
          ? `Ready to protect ${nextFile.name}. Enter a new password to continue.`
          : `Ready to unlock ${nextFile.name}. Enter its current password to continue.`
      );
      window.setTimeout(() => {
        if (nextLoadId === fileLoadIdRef.current) {
          setIsPreparingFile(false);
          setCurrentStep(2);
        }
      }, 250);
    } catch (error) {
      if (nextLoadId !== fileLoadIdRef.current) {
        return;
      }

      setIsPreparingFile(false);
      setPreparingFileName("");
      setFileLoadProgress(0);
      setErrorMessage(error.message);
      setStatus("The PDF could not be loaded.");
    }
  }

  function handleImmediateReset() {
    fileLoadIdRef.current += 1;

    if (downloadUrlRef.current) {
      URL.revokeObjectURL(downloadUrlRef.current);
      downloadUrlRef.current = "";
    }

    setCurrentStep(0);
    setMode("");
    setSelectedFile(null);
    setPreparingFileName("");
    setPassword("");
    setDownloadUrl("");
    setOutputFileName("unlocked.pdf");
    setPageCount(0);
    setProgress(0);
    setErrorMessage("");
    setIsPreparingFile(false);
    setFileLoadProgress(0);
    setDetectedProtectionState("");
    setStatus(getDefaultStatus(""));
  }

  function handleResetFlow() {
    setIsResetting(true);

    window.setTimeout(() => {
      handleImmediateReset();
      setIsResetting(false);
    }, 450);
  }

  function handleModeSelect(nextMode) {
    setMode(nextMode);
    setCurrentStep(1);
    setSelectedFile(null);
    setPreparingFileName("");
    setPassword("");
    setDownloadUrl("");
    setOutputFileName("unlocked.pdf");
    setPageCount(0);
    setProgress(0);
    setErrorMessage("");
    setIsPreparingFile(false);
    setFileLoadProgress(0);
    setDetectedProtectionState("");
    setStatus(getDefaultStatus(nextMode));
  }

  return (
    <>
      <Script src={PDFJS_CDN} strategy="afterInteractive" onLoad={() => setPdfJsReady(true)} />

      <main className="h-screen overflow-hidden bg-[#ece9e2]">
        <header className="border-b-[3px] border-black bg-[linear-gradient(180deg,#e7ba52_0%,#d69d29_100%)] px-4 py-4 text-center shadow-[inset_0_2px_0_0_#f8df9b]">
          <p className="text-2xl font-black uppercase tracking-[0.18em] text-[#2a1800] drop-shadow-[2px_2px_0_rgba(255,244,200,0.55)] sm:text-4xl">
            OpenPls!
          </p>
        </header>

        <section className="mx-auto flex h-[calc(100vh-88px)] w-full max-w-4xl flex-col justify-center px-4 py-4 sm:px-6">
          <div className="mx-auto mb-4 flex w-full max-w-3xl items-center justify-between gap-3">
            <div className="w-14 shrink-0" />
            <div className="flex items-center justify-center gap-3">
              {mode ? (
                [1, 2, 3].map((step) => (
                  <div
                    key={step}
                    className={`border-[3px] border-black px-4 py-2 text-sm font-black uppercase tracking-[0.14em] ${
                      currentStep === step ? "bg-[#ef5a5a] text-white" : "bg-white text-black"
                    }`}
                  >
                    {step === 1 ? "File" : step === 2 ? "Password" : "Result"}
                  </div>
                ))
              ) : (
                <div className="border-[3px] border-black bg-white px-5 py-2 text-sm font-black uppercase tracking-[0.14em] text-black">
                  Choose Mode
                </div>
              )}
            </div>
            {currentStep === 0 ? <div className="w-14 shrink-0" /> : (
              <button
                type="button"
                onClick={handleResetFlow}
                aria-label="Refresh flow"
                className="inline-flex h-14 w-14 shrink-0 cursor-pointer items-center justify-center border-[3px] border-black bg-white transition hover:bg-[#f3f3f3]"
              >
                <Image
                  src={reloadIcon}
                  alt=""
                  className={`h-8 w-8 ${isResetting ? "animate-spin" : ""}`}
                />
              </button>
            )}
          </div>

          <form onSubmit={handleUnlock} className="mx-auto w-full max-w-3xl">
            {currentStep === 0 ? (
              <div className="grid gap-5 md:grid-cols-2">
                <button
                  type="button"
                  onClick={() => handleModeSelect("unlock")}
                  className="border-[4px] border-black bg-[#8fded3] p-6 text-left shadow-[8px_8px_0_0_#000] transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none"
                >
                  <Image src={unlockModeIcon} alt="" className="h-20 w-20" />
                  <p className="mt-5 text-2xl font-black uppercase text-black">Unlock</p>
                  <p className="mt-3 text-sm leading-6 text-black/80">
                    Remove the password from a protected PDF when you already know the current password.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => handleModeSelect("lock")}
                  className="border-[4px] border-black bg-[#f7d95a] p-6 text-left shadow-[8px_8px_0_0_#000] transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none"
                >
                  <Image src={lockModeIcon} alt="" className="h-20 w-20" />
                  <p className="mt-5 text-2xl font-black uppercase text-black">Lock</p>
                  <p className="mt-3 text-sm leading-6 text-black/80">
                    Add a new password to a PDF and download the protected version.
                  </p>
                </button>
              </div>
            ) : null}

            {currentStep === 1 ? (
              <div className="border-[4px] border-black bg-[#9ec4f0] p-4 shadow-[8px_8px_0_0_#000]">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-black uppercase tracking-[0.18em] text-black">
                      Choose File
                    </p>
                    <p className="mt-2 text-sm leading-6 text-black/75">
                      {mode === "lock"
                        ? "Upload the PDF you want to protect."
                        : "Upload your protected PDF to start."}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {detectedProtectionState ? (
                      <div
                        className={`border-[3px] border-black px-3 py-1 text-xs font-black uppercase ${
                          detectedProtectionState === "protected"
                            ? "bg-[#ef5a5a] text-white"
                            : "bg-[#8fded3] text-black"
                        }`}
                      >
                        {detectedProtectionState === "protected" ? "Protected PDF" : "Unlocked PDF"}
                      </div>
                    ) : null}
                    <div className="border-[3px] border-black bg-white px-3 py-1 text-xs font-black uppercase text-black">
                      {isPreparingFile ? "Loading" : selectedFile ? "Ready" : "Waiting"}
                    </div>
                  </div>
                </div>

                <label
                  htmlFor="pdf-file"
                  className="mt-4 flex min-h-36 cursor-pointer flex-col items-center justify-center border-[4px] border-dashed border-black bg-white/35 px-6 py-6 text-center transition hover:bg-white/50"
                >
                  <span className="text-xl font-black uppercase text-black sm:text-2xl">
                    {isPreparingFile ? "Loading PDF" : selectedFile ? "PDF Selected" : "Upload PDF"}
                  </span>
                  <span className="mt-2 max-w-xl text-sm leading-6 text-black/75">
                    {isPreparingFile
                      ? preparingFileName
                      : selectedFile
                        ? selectedFile.name
                        : "Click here to choose a protected PDF file"}
                  </span>
                </label>
                <input
                  id="pdf-file"
                  type="file"
                  accept="application/pdf"
                  onChange={handleFileChange}
                  className="sr-only"
                />

                {errorMessage ? (
                  <div className="mt-4 border-[3px] border-black bg-[#f18d8d] p-4 text-sm leading-6 text-black">
                    {errorMessage}
                  </div>
                ) : null}

              </div>
            ) : null}

            {currentStep === 2 ? (
              <div className="border-[4px] border-black bg-[#b9e4bf] p-4 shadow-[8px_8px_0_0_#000]">
                <p className="text-sm font-black uppercase tracking-[0.18em] text-black">Password</p>
                <p className="mt-2 text-sm leading-6 text-black/75">
                  {mode === "lock"
                    ? `Enter a new password for ${selectedFile?.name || "your PDF"}.`
                    : `Enter the current password for ${selectedFile?.name || "your PDF"}.`}
                </p>
                <label className="sr-only" htmlFor="pdf-password">
                  Password
                </label>
                <input
                  id="pdf-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={mode === "lock" ? "Enter new password" : "Enter current password"}
                  className="mt-4 w-full border-[4px] border-black bg-white px-4 py-3 text-base text-black outline-none placeholder:text-black/45"
                />
                {errorMessage ? (
                  <div className="mt-4 border-[3px] border-black bg-[#f18d8d] p-4 text-sm leading-6 text-black">
                    {errorMessage}
                  </div>
                ) : null}
                <div className="mt-5 flex flex-wrap justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setCurrentStep(1)}
                    className="inline-flex items-center justify-center border-[4px] border-black bg-white px-6 py-3 text-base font-black uppercase text-black"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={isProcessing}
                    className="inline-flex items-center justify-center border-[4px] border-black bg-[#58b4e6] px-6 py-3 text-base font-black uppercase text-black disabled:cursor-not-allowed disabled:bg-[#9ccde6]"
                  >
                    {isProcessing ? (mode === "lock" ? "Locking..." : "Unlocking...") : mode === "lock" ? "Lock PDF" : "Unlock PDF"}
                  </button>
                </div>
              </div>
            ) : null}

            {currentStep === 3 ? (
              <div className="border-[4px] border-black bg-[#f7d95a] p-4 shadow-[8px_8px_0_0_#000]">
                <p className="text-sm font-black uppercase tracking-[0.18em] text-black">Result</p>
                <p className="mt-3 text-sm leading-6 text-black/80">{status}</p>
                <div className="mt-4 h-4 border-[3px] border-black bg-white">
                  <div className="h-full bg-[#ef5a5a] transition-all" style={{ width: `${progress}%` }} />
                </div>
                <div className="mt-3 flex justify-between text-xs font-bold uppercase tracking-[0.08em] text-black/75">
                  <span>{pageCount ? `${pageCount} pages` : "No file"}</span>
                  <span>{progress}%</span>
                </div>

                {errorMessage ? (
                  <div className="mt-4 border-[3px] border-black bg-[#f18d8d] p-4 text-sm leading-6 text-black">
                    {errorMessage}
                  </div>
                ) : null}

                {downloadUrl ? (
                  <a
                    href={downloadUrl}
                    download={outputFileName}
                    className="mt-4 inline-flex w-full items-center justify-center border-[4px] border-black bg-[#8fded3] px-5 py-3 text-base font-black uppercase text-black"
                  >
                    Download PDF
                  </a>
                ) : null}

                <div className="mt-5 flex flex-wrap justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setCurrentStep(2)}
                    className="inline-flex items-center justify-center border-[4px] border-black bg-white px-6 py-3 text-base font-black uppercase text-black"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={handleImmediateReset}
                    className="inline-flex items-center justify-center border-[4px] border-black bg-[#f7db62] px-6 py-3 text-base font-black uppercase text-black"
                  >
                    Start Over
                  </button>
                </div>
              </div>
            ) : null}
          </form>
        </section>

        {showInfo ? (
          <div
            ref={infoPanelRef}
            className="fixed bottom-20 left-4 z-50 flex max-w-[calc(100vw-2rem)] items-center border-[3px] border-black bg-white px-4 py-3 text-sm font-bold text-black shadow-[6px_6px_0_0_#000] sm:left-6"
          >
            <span>Version 0.1.0 | Developer: </span>
            <a
              href="https://github.com/ThantHtetMyet"
              target="_blank"
              rel="noopener noreferrer"
              className="ml-1 underline"
            >
              https://github.com/ThantHtetMyet
            </a>
          </div>
        ) : null}

        <button
          ref={infoButtonRef}
          type="button"
          onClick={() => setShowInfo((currentValue) => !currentValue)}
          aria-label="Show information"
          className="fixed bottom-4 left-4 z-50 inline-flex h-14 w-14 cursor-pointer items-center justify-center border-[3px] border-black bg-white transition hover:bg-[#f3f3f3] sm:left-6"
        >
          <Image src={informationIcon} alt="" className="h-8 w-8" />
        </button>

        {isPreparingFile ? (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/25 px-4">
            <div className="w-full max-w-2xl border-[4px] border-black bg-[#f7d95a] p-6 shadow-[10px_10px_0_0_#000]">
              <p className="text-sm font-black uppercase tracking-[0.18em] text-black">
                Loading PDF
              </p>
              <p className="mt-3 text-2xl font-black uppercase text-black sm:text-3xl">
                Preparing File
              </p>
              <p className="mt-3 text-sm leading-6 text-black/80 sm:text-base">
                {preparingFileName}
              </p>
              <div className="mt-5 h-5 border-[4px] border-black bg-white">
                <div
                  className="h-full bg-[#ef5a5a] transition-all"
                  style={{ width: `${fileLoadProgress}%` }}
                />
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 text-sm font-black uppercase tracking-[0.08em] text-black">
                <span>Please wait...</span>
                <span>{fileLoadProgress}%</span>
              </div>
              <p className="mt-4 border-[3px] border-black bg-[#9ec4f0] px-4 py-3 text-sm leading-6 text-black">
                Your PDF is loading now. OpenPls will check the file first, then move to the password page only when the selected mode is valid.
              </p>
            </div>
          </div>
        ) : null}
      </main>
    </>
  );
}
