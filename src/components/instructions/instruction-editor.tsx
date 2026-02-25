"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UploadCloud } from "lucide-react";
import { createPortal } from "react-dom";

import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn, escapeLikeQuery } from "@/lib/utils";

interface InstructionEditorProps {
  mode: "create" | "edit" | "fork";
  initialData?: {
    instructionId?: string;
    sourceInstructionId?: string;
    workItemId?: string;
    departmentId?: string;
    partNumber: string;
    moldNumber: string;
    itemTitle: string;
    bodyMarkdown: string;
    revision: number;
  };
}

interface WorkItemSearchResult {
  id: string;
  department_id: string;
  part_number: string;
  mold_number: string;
  item_title: string;
  departments:
    | {
        name: string;
      }
    | Array<{
        name: string;
      }>
    | null;
}

interface DepartmentOption {
  id: string;
  name: string;
}

interface EditorSnapshot {
  departmentId: string;
  partNumber: string;
  moldNumber: string;
  itemTitle: string;
  bodyMarkdown: string;
  revision: number;
}

interface InstructionChangeSourceMedia {
  type: "image" | "video";
  src: string;
}

interface InstructionChangeSourcePayload {
  addedTextSnippet?: string;
  removedTextSnippet?: string;
  addedMedia?: InstructionChangeSourceMedia[];
  removedMedia?: InstructionChangeSourceMedia[];
  previousRevision?: number;
  nextRevision?: number;
  mediaFormattingUpdated?: boolean;
}

interface InstructionChangeComputation {
  summary: string;
  sourcePayload: InstructionChangeSourcePayload | null;
}

type PendingNavigation =
  | {
      kind: "history-back";
    }
  | {
      kind: "internal-link";
      href: string;
    }
  | {
      kind: "external-link";
      href: string;
    };

interface FieldErrors {
  department: boolean;
  partOrMold: boolean;
  itemTitle: boolean;
  revision: boolean;
  body: boolean;
}

const DEFAULT_FIELD_ERRORS: FieldErrors = {
  department: false,
  partOrMold: false,
  itemTitle: false,
  revision: false,
  body: false,
};

const HISTORY_GUARD_STATE_KEY = "__instructionEditorUnsavedGuard";

function looksLikeHtml(value: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function plainTextToHtml(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  return trimmed
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function normalizeEditorContent(value: string): string {
  if (!value.trim()) {
    return "";
  }

  if (looksLikeHtml(value)) {
    return value;
  }

  return plainTextToHtml(value);
}

function richTextToPlain(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h1|h2|h3|h4|h5|h6)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function summarizePartMold(partNumber: string, moldNumber: string) {
  const part = partNumber.trim();
  const mold = moldNumber.trim();

  if (part && mold) {
    return `${part} | ${mold}`;
  }

  return part || mold || "";
}

function normalizeSubmissionError(error: unknown) {
  return error instanceof Error ? error.message : "Save failed";
}

function normalizeSnapshotValue(value: string) {
  return value.trim();
}

function buildSnapshot(data: {
  departmentId: string;
  partNumber: string;
  moldNumber: string;
  itemTitle: string;
  bodyMarkdown: string;
  revision: number;
}): EditorSnapshot {
  return {
    departmentId: normalizeSnapshotValue(data.departmentId),
    partNumber: normalizeSnapshotValue(data.partNumber),
    moldNumber: normalizeSnapshotValue(data.moldNumber),
    itemTitle: normalizeSnapshotValue(data.itemTitle),
    bodyMarkdown: normalizeEditorContent(data.bodyMarkdown),
    revision: data.revision,
  };
}

function extractInlineMediaDetails(content: string) {
  const normalizedContent = normalizeEditorContent(content);
  const imageSources = new Set<string>();
  const videoSources = new Set<string>();
  const mediaPattern = /<(img|video)\b[^>]*\bsrc=(["'])(.*?)\2[^>]*>/gi;

  let match = mediaPattern.exec(normalizedContent);
  while (match) {
    const mediaTag = match[1]?.toLowerCase();
    const source = match[3]?.trim();
    if (source) {
      if (mediaTag === "img") {
        imageSources.add(source);
      } else if (mediaTag === "video") {
        videoSources.add(source);
      }
    }

    match = mediaPattern.exec(normalizedContent);
  }

  return {
    imageSources,
    videoSources,
    allSources: new Set([...imageSources, ...videoSources]),
  };
}

function extractMediaMarkupSignatures(content: string) {
  const normalizedContent = normalizeEditorContent(content);
  const mediaMarkupPattern = /<(figure|img|video)\b[^>]*>/gi;
  const signatures: string[] = [];

  let match = mediaMarkupPattern.exec(normalizedContent);
  while (match) {
    signatures.push((match[0] ?? "").replace(/\s+/g, " ").trim());
    match = mediaMarkupPattern.exec(normalizedContent);
  }

  return signatures;
}

function collectAddedMedia(
  nextSources: Set<string>,
  previousSources: Set<string>,
  mediaType: "image" | "video",
) {
  const added: InstructionChangeSourceMedia[] = [];
  for (const source of nextSources) {
    if (!previousSources.has(source)) {
      added.push({
        type: mediaType,
        src: source,
      });
    }
  }
  return added;
}

function collectRemovedMedia(
  previousSources: Set<string>,
  nextSources: Set<string>,
  mediaType: "image" | "video",
) {
  const removed: InstructionChangeSourceMedia[] = [];
  for (const source of previousSources) {
    if (!nextSources.has(source)) {
      removed.push({
        type: mediaType,
        src: source,
      });
    }
  }
  return removed;
}

function extractTextChangeSnippet(previousText: string, nextText: string) {
  if (previousText === nextText) {
    return {
      addedTextSnippet: "",
      removedTextSnippet: "",
    };
  }

  let prefixIndex = 0;
  const sharedMaxLength = Math.min(previousText.length, nextText.length);
  while (
    prefixIndex < sharedMaxLength &&
    previousText[prefixIndex] === nextText[prefixIndex]
  ) {
    prefixIndex += 1;
  }

  let previousSuffixIndex = previousText.length - 1;
  let nextSuffixIndex = nextText.length - 1;
  while (
    previousSuffixIndex >= prefixIndex &&
    nextSuffixIndex >= prefixIndex &&
    previousText[previousSuffixIndex] === nextText[nextSuffixIndex]
  ) {
    previousSuffixIndex -= 1;
    nextSuffixIndex -= 1;
  }

  const removedTextSnippet = previousText
    .slice(prefixIndex, previousSuffixIndex + 1)
    .trim();
  const addedTextSnippet = nextText.slice(prefixIndex, nextSuffixIndex + 1).trim();

  return {
    addedTextSnippet,
    removedTextSnippet,
  };
}

function hasSourcePayloadData(sourcePayload: InstructionChangeSourcePayload) {
  return Boolean(
    sourcePayload.addedTextSnippet ||
      sourcePayload.removedTextSnippet ||
      (sourcePayload.addedMedia?.length ?? 0) > 0 ||
      (sourcePayload.removedMedia?.length ?? 0) > 0 ||
      sourcePayload.mediaFormattingUpdated ||
      sourcePayload.previousRevision !== undefined ||
      sourcePayload.nextRevision !== undefined,
  );
}

function countAddedMedia(nextSources: Set<string>, previousSources: Set<string>) {
  let count = 0;
  for (const source of nextSources) {
    if (!previousSources.has(source)) {
      count += 1;
    }
  }
  return count;
}

function countRemovedMedia(previousSources: Set<string>, nextSources: Set<string>) {
  let count = 0;
  for (const source of previousSources) {
    if (!nextSources.has(source)) {
      count += 1;
    }
  }
  return count;
}

function buildInstructionUpdateSummary(params: {
  previousBody: string;
  nextBody: string;
  previousRevision: number;
  nextRevision: number;
}): InstructionChangeComputation {
  const previousNormalized = normalizeEditorContent(params.previousBody);
  const nextNormalized = normalizeEditorContent(params.nextBody);
  const summaryParts: string[] = [];
  const sourcePayload: InstructionChangeSourcePayload = {};

  const previousPlainTextRaw = richTextToPlain(previousNormalized);
  const nextPlainTextRaw = richTextToPlain(nextNormalized);
  const previousPlainText = previousPlainTextRaw.replace(/\s+/g, " ").trim();
  const nextPlainText = nextPlainTextRaw.replace(/\s+/g, " ").trim();
  const characterDelta = nextPlainText.length - previousPlainText.length;

  if (previousPlainText !== nextPlainText) {
    const textSnippet = extractTextChangeSnippet(previousPlainTextRaw, nextPlainTextRaw);
    if (textSnippet.addedTextSnippet) {
      sourcePayload.addedTextSnippet = textSnippet.addedTextSnippet;
    }
    if (textSnippet.removedTextSnippet) {
      sourcePayload.removedTextSnippet = textSnippet.removedTextSnippet;
    }

    if (characterDelta > 0) {
      summaryParts.push(`${characterDelta} characters added`);
    } else if (characterDelta < 0) {
      summaryParts.push(`${Math.abs(characterDelta)} characters removed`);
    } else {
      summaryParts.push("Instruction text edited");
    }
  }

  const previousMedia = extractInlineMediaDetails(previousNormalized);
  const nextMedia = extractInlineMediaDetails(nextNormalized);

  const addedImages = countAddedMedia(nextMedia.imageSources, previousMedia.imageSources);
  const removedImages = countRemovedMedia(previousMedia.imageSources, nextMedia.imageSources);
  const addedVideos = countAddedMedia(nextMedia.videoSources, previousMedia.videoSources);
  const removedVideos = countRemovedMedia(previousMedia.videoSources, nextMedia.videoSources);
  const addedMediaCount = addedImages + addedVideos;
  const removedMediaCount = removedImages + removedVideos;
  const addedMedia = [
    ...collectAddedMedia(nextMedia.imageSources, previousMedia.imageSources, "image"),
    ...collectAddedMedia(nextMedia.videoSources, previousMedia.videoSources, "video"),
  ];
  const removedMedia = [
    ...collectRemovedMedia(previousMedia.imageSources, nextMedia.imageSources, "image"),
    ...collectRemovedMedia(previousMedia.videoSources, nextMedia.videoSources, "video"),
  ];

  if (addedMedia.length > 0) {
    sourcePayload.addedMedia = addedMedia;
  }
  if (removedMedia.length > 0) {
    sourcePayload.removedMedia = removedMedia;
  }

  if (addedImages > 0) {
    summaryParts.push(`Image${addedImages === 1 ? "" : "s"} added (+${addedImages})`);
  }
  if (removedImages > 0) {
    summaryParts.push(`Image${removedImages === 1 ? "" : "s"} removed (-${removedImages})`);
  }
  if (addedVideos > 0) {
    summaryParts.push(`Video${addedVideos === 1 ? "" : "s"} added (+${addedVideos})`);
  }
  if (removedVideos > 0) {
    summaryParts.push(`Video${removedVideos === 1 ? "" : "s"} removed (-${removedVideos})`);
  }

  const previousMediaMarkupSignatures = extractMediaMarkupSignatures(previousNormalized);
  const nextMediaMarkupSignatures = extractMediaMarkupSignatures(nextNormalized);
  const mediaMarkupChanged =
    previousMediaMarkupSignatures.length === nextMediaMarkupSignatures.length
      ? previousMediaMarkupSignatures.some(
          (signature, index) => signature !== nextMediaMarkupSignatures[index],
        )
      : previousMediaMarkupSignatures.length !== nextMediaMarkupSignatures.length;

  if (
    (previousMedia.allSources.size > 0 || nextMedia.allSources.size > 0) &&
    mediaMarkupChanged &&
    addedMediaCount === 0 &&
    removedMediaCount === 0
  ) {
    summaryParts.push("Media formatting updated");
    sourcePayload.mediaFormattingUpdated = true;
  }

  if (params.previousRevision !== params.nextRevision) {
    summaryParts.push(`Revision ${params.previousRevision} -> ${params.nextRevision}`);
    sourcePayload.previousRevision = params.previousRevision;
    sourcePayload.nextRevision = params.nextRevision;
  }

  if (summaryParts.length === 0) {
    summaryParts.push("Instruction details updated");
  }

  return {
    summary: `${summaryParts.join("; ")}.`,
    sourcePayload: hasSourcePayloadData(sourcePayload) ? sourcePayload : null,
  };
}

function buildInstructionCreateSummary(body: string, revision: number) {
  const normalizedBody = normalizeEditorContent(body);
  const mediaDetails = extractInlineMediaDetails(normalizedBody);
  const textLength = richTextToPlain(normalizedBody).replace(/\s+/g, " ").trim().length;
  const summaryParts: string[] = [`Revision ${revision} created`];

  if (textLength > 0) {
    summaryParts.push(`${textLength} characters in instruction text`);
  }

  if (mediaDetails.imageSources.size > 0) {
    summaryParts.push(
      `${mediaDetails.imageSources.size} image${mediaDetails.imageSources.size === 1 ? "" : "s"} added`,
    );
  }

  if (mediaDetails.videoSources.size > 0) {
    summaryParts.push(
      `${mediaDetails.videoSources.size} video${mediaDetails.videoSources.size === 1 ? "" : "s"} added`,
    );
  }

  return `${summaryParts.join("; ")}.`;
}

function snapshotsAreEqual(a: EditorSnapshot, b: EditorSnapshot) {
  return (
    a.departmentId === b.departmentId &&
    a.partNumber === b.partNumber &&
    a.moldNumber === b.moldNumber &&
    a.itemTitle === b.itemTitle &&
    a.bodyMarkdown === b.bodyMarkdown &&
    a.revision === b.revision
  );
}

function getDepartmentNameFromRelation(
  relation: WorkItemSearchResult["departments"],
): string {
  if (!relation) {
    return "Unknown";
  }

  if (Array.isArray(relation)) {
    return relation[0]?.name ?? "Unknown";
  }

  return relation.name;
}

export function InstructionEditor({ mode, initialData }: InstructionEditorProps) {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [departmentsBusy, setDepartmentsBusy] = useState(false);
  const [departmentId, setDepartmentId] = useState(initialData?.departmentId ?? "");
  const [departmentTouched, setDepartmentTouched] = useState(false);

  const [partNumber, setPartNumber] = useState(initialData?.partNumber ?? "");
  const [moldNumber, setMoldNumber] = useState(initialData?.moldNumber ?? "");
  const [partSuggestions, setPartSuggestions] = useState<WorkItemSearchResult[]>([]);
  const [moldSuggestions, setMoldSuggestions] = useState<WorkItemSearchResult[]>([]);
  const [partSearchBusy, setPartSearchBusy] = useState(false);
  const [moldSearchBusy, setMoldSearchBusy] = useState(false);
  const [partSearchOpen, setPartSearchOpen] = useState(false);
  const [moldSearchOpen, setMoldSearchOpen] = useState(false);

  const [workItemId, setWorkItemId] = useState<string | null>(
    mode === "edit" ? (initialData?.workItemId ?? null) : null,
  );
  const [itemTitle, setItemTitle] = useState(initialData?.itemTitle ?? "");
  const [bodyMarkdown, setBodyMarkdown] = useState(
    normalizeEditorContent(initialData?.bodyMarkdown ?? ""),
  );
  const [revision, setRevision] = useState(initialData?.revision ?? 1);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>(DEFAULT_FIELD_ERRORS);
  const [bodyFocusRequestKey, setBodyFocusRequestKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [portalReady, setPortalReady] = useState(false);
  const [forkCanceledModalOpen, setForkCanceledModalOpen] = useState(false);
  const [navigationModalOpen, setNavigationModalOpen] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null);

  const partInputRef = useRef<HTMLInputElement | null>(null);
  const moldInputRef = useRef<HTMLInputElement | null>(null);
  const itemTitleInputRef = useRef<HTMLInputElement | null>(null);
  const hasUnsavedChangesRef = useRef(false);
  const navigationModalOpenRef = useRef(false);
  const historyGuardActiveRef = useRef(false);
  const suppressNextPopStateRef = useRef(false);
  const pendingNavigationRef = useRef<PendingNavigation | null>(null);
  const navigationBypassRef = useRef(false);

  const initialSnapshot = useMemo(
    () =>
      buildSnapshot({
        departmentId: initialData?.departmentId ?? "",
        partNumber: initialData?.partNumber ?? "",
        moldNumber: initialData?.moldNumber ?? "",
        itemTitle: initialData?.itemTitle ?? "",
        bodyMarkdown: initialData?.bodyMarkdown ?? "",
        revision: initialData?.revision ?? 1,
      }),
    [initialData],
  );

  const currentSnapshot = useMemo(
    () =>
      buildSnapshot({
        departmentId,
        partNumber,
        moldNumber,
        itemTitle,
        bodyMarkdown,
        revision,
      }),
    [bodyMarkdown, departmentId, itemTitle, moldNumber, partNumber, revision],
  );

  const createModeHasMeaningfulChanges = useMemo(() => {
    const hasContentChanges =
      currentSnapshot.partNumber.length > 0 ||
      currentSnapshot.moldNumber.length > 0 ||
      currentSnapshot.itemTitle.length > 0 ||
      currentSnapshot.revision !== initialSnapshot.revision ||
      richTextToPlain(currentSnapshot.bodyMarkdown).length > 0;

    const hasDepartmentChange = departmentTouched
      ? currentSnapshot.departmentId !== initialSnapshot.departmentId
      : false;

    return hasContentChanges || hasDepartmentChange;
  }, [currentSnapshot, departmentTouched, initialSnapshot.departmentId, initialSnapshot.revision]);

  const hasUnsavedChanges = useMemo(() => {
    if (mode === "create") {
      return createModeHasMeaningfulChanges;
    }

    return !snapshotsAreEqual(currentSnapshot, initialSnapshot);
  }, [createModeHasMeaningfulChanges, currentSnapshot, initialSnapshot, mode]);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    if (mode === "create") {
      void router.prefetch("/dashboard");
    }
  }, [mode, router]);

  const releaseHistoryGuard = useCallback(() => {
    if (!historyGuardActiveRef.current) {
      return;
    }

    suppressNextPopStateRef.current = true;
    historyGuardActiveRef.current = false;
    window.history.back();
  }, []);

  const navigateWithGuardReleased = useCallback(
    (navigate: () => void) => {
      if (historyGuardActiveRef.current) {
        releaseHistoryGuard();
        window.setTimeout(() => {
          navigate();
        }, 0);
        return;
      }

      navigate();
    },
    [releaseHistoryGuard],
  );

  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges;
  }, [hasUnsavedChanges]);

  useEffect(() => {
    navigationModalOpenRef.current = navigationModalOpen;
  }, [navigationModalOpen]);

  useEffect(() => {
    pendingNavigationRef.current = pendingNavigation;
  }, [pendingNavigation]);

  useEffect(() => {
    if (!hasUnsavedChanges) {
      if (historyGuardActiveRef.current) {
        releaseHistoryGuard();
      }

      setNavigationModalOpen(false);
      pendingNavigationRef.current = null;
      setPendingNavigation(null);
      return;
    }

    if (!historyGuardActiveRef.current) {
      window.history.pushState({ [HISTORY_GUARD_STATE_KEY]: true }, "", window.location.href);
      historyGuardActiveRef.current = true;
    }
  }, [hasUnsavedChanges, releaseHistoryGuard]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChangesRef.current || navigationBypassRef.current) {
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      if (suppressNextPopStateRef.current) {
        suppressNextPopStateRef.current = false;
        return;
      }

      if (!hasUnsavedChangesRef.current || navigationBypassRef.current) {
        historyGuardActiveRef.current = false;
        return;
      }

      if (navigationModalOpenRef.current) {
        window.history.pushState({ [HISTORY_GUARD_STATE_KEY]: true }, "", window.location.href);
        historyGuardActiveRef.current = true;
        return;
      }

      window.history.pushState({ [HISTORY_GUARD_STATE_KEY]: true }, "", window.location.href);
      historyGuardActiveRef.current = true;
      openNavigationModal({ kind: "history-back" });
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  useEffect(() => {
    const handleDocumentNavigation = (event: MouseEvent) => {
      if (!hasUnsavedChangesRef.current || navigationBypassRef.current) {
        return;
      }

      if (event.defaultPrevented || event.button !== 0) {
        return;
      }

      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      const target = event.target as Element | null;
      const anchor = target?.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }

      if (anchor.target && anchor.target !== "_self") {
        return;
      }

      if (anchor.hasAttribute("download")) {
        return;
      }

      let destination: URL;
      try {
        destination = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }

      if (destination.href === window.location.href) {
        return;
      }

      event.preventDefault();

      if (destination.origin === window.location.origin) {
        openNavigationModal({ kind: "internal-link", href: destination.href });
      } else {
        openNavigationModal({ kind: "external-link", href: destination.href });
      }
    };

    document.addEventListener("click", handleDocumentNavigation, true);
    return () => {
      document.removeEventListener("click", handleDocumentNavigation, true);
    };
  }, []);

  useEffect(() => {
    let isActive = true;
    setDepartmentsBusy(true);

    void (async () => {
      try {
        const { data, error: departmentsError } = await supabase
          .from("departments")
          .select("id, name")
          .order("sort_order", { ascending: true })
          .order("name", { ascending: true });

        if (!isActive) {
          return;
        }

        if (departmentsError) {
          throw departmentsError;
        }

        const resolvedDepartments = (data ?? []) as DepartmentOption[];
        setDepartments(resolvedDepartments);
      } catch {
        if (!isActive) {
          return;
        }
        setDepartments([]);
      } finally {
        if (isActive) {
          setDepartmentsBusy(false);
        }
      }
    })();

    return () => {
      isActive = false;
    };
  }, [supabase]);

  useEffect(() => {
    if (departmentId || departments.length === 0) {
      return;
    }

    setDepartmentId(departments[0].id);
  }, [departmentId, departments]);

  useEffect(() => {
    const query = partNumber.trim();
    if (query.length < 2) {
      setPartSuggestions([]);
      setPartSearchBusy(false);
      return;
    }

    let isActive = true;
    const timer = window.setTimeout(() => {
      void (async () => {
        setPartSearchBusy(true);
        try {
          const safeQuery = escapeLikeQuery(query);
          const { data, error: searchError } = await supabase
            .from("work_items")
            .select(
              "id, department_id, part_number, mold_number, item_title, departments(name), work_instructions!inner(id)",
            )
            .ilike("part_number", `%${safeQuery}%`)
            .eq("work_instructions.is_archived", false)
            .order("updated_at", { ascending: false })
            .limit(8);

          if (!isActive) {
            return;
          }

          if (searchError) {
            throw searchError;
          }

          setPartSuggestions((data ?? []) as WorkItemSearchResult[]);
        } catch {
          if (!isActive) {
            return;
          }

          setPartSuggestions([]);
        } finally {
          if (isActive) {
            setPartSearchBusy(false);
          }
        }
      })();
    }, 200);

    return () => {
      isActive = false;
      window.clearTimeout(timer);
    };
  }, [partNumber, supabase]);

  useEffect(() => {
    const query = moldNumber.trim();
    if (query.length < 2) {
      setMoldSuggestions([]);
      setMoldSearchBusy(false);
      return;
    }

    let isActive = true;
    const timer = window.setTimeout(() => {
      void (async () => {
        setMoldSearchBusy(true);
        try {
          const safeQuery = escapeLikeQuery(query);
          const { data, error: searchError } = await supabase
            .from("work_items")
            .select(
              "id, department_id, part_number, mold_number, item_title, departments(name), work_instructions!inner(id)",
            )
            .ilike("mold_number", `%${safeQuery}%`)
            .eq("work_instructions.is_archived", false)
            .order("updated_at", { ascending: false })
            .limit(8);

          if (!isActive) {
            return;
          }

          if (searchError) {
            throw searchError;
          }

          setMoldSuggestions((data ?? []) as WorkItemSearchResult[]);
        } catch {
          if (!isActive) {
            return;
          }

          setMoldSuggestions([]);
        } finally {
          if (isActive) {
            setMoldSearchBusy(false);
          }
        }
      })();
    }, 200);

    return () => {
      isActive = false;
      window.clearTimeout(timer);
    };
  }, [moldNumber, supabase]);

  function applySuggestedWorkItem(result: WorkItemSearchResult) {
    setDepartmentTouched(true);
    setDepartmentId(result.department_id);
    setPartNumber(result.part_number);
    setMoldNumber(result.mold_number);
    setItemTitle(result.item_title);
    setWorkItemId(result.id);
    setPartSearchOpen(false);
    setMoldSearchOpen(false);
    setFieldErrors((current) => ({
      ...current,
      department: false,
      partOrMold: false,
      itemTitle: false,
    }));
  }

  function setPartOrMoldErrorAndFocus() {
    setFieldErrors((current) => ({
      ...current,
      partOrMold: true,
    }));
    partInputRef.current?.focus();
  }

  function closeNavigationModal() {
    pendingNavigationRef.current = null;
    setNavigationModalOpen(false);
    setPendingNavigation(null);
  }

  function openNavigationModal(nextNavigation: PendingNavigation) {
    pendingNavigationRef.current = nextNavigation;
    setPendingNavigation(nextNavigation);
    setNavigationModalOpen(true);
  }

  function handleCancelNavigationAway() {
    if (
      pendingNavigationRef.current?.kind === "history-back" &&
      hasUnsavedChangesRef.current &&
      !historyGuardActiveRef.current
    ) {
      window.history.pushState({ [HISTORY_GUARD_STATE_KEY]: true }, "", window.location.href);
      historyGuardActiveRef.current = true;
    }

    navigationBypassRef.current = false;
    closeNavigationModal();
  }

  function handleConfirmNavigationAway() {
    const navigation = pendingNavigationRef.current;
    if (!navigation) {
      closeNavigationModal();
      return;
    }

    navigationBypassRef.current = true;
    closeNavigationModal();

    if (navigation.kind === "history-back") {
      navigateWithGuardReleased(() => {
        if (window.history.length <= 2) {
          router.push("/dashboard");
          return;
        }

        router.back();
      });
      return;
    }

    window.location.assign(navigation.href);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setBusy(true);
    setMessage(null);
    setError(null);
    setFieldErrors(DEFAULT_FIELD_ERRORS);

    const normalizedPartNumber = partNumber.trim();
    const normalizedMoldNumber = moldNumber.trim();
    const normalizedDepartmentId = departmentId.trim();

    if (mode === "fork" && snapshotsAreEqual(currentSnapshot, initialSnapshot)) {
      setForkCanceledModalOpen(true);
      setBusy(false);
      return;
    }

    if (!normalizedDepartmentId) {
      setFieldErrors((current) => ({
        ...current,
        department: true,
      }));
      setError("Department is required.");
      setBusy(false);
      return;
    }

    if (!normalizedPartNumber && !normalizedMoldNumber) {
      setPartOrMoldErrorAndFocus();
      setError("Part # or Mold # is required.");
      setBusy(false);
      return;
    }

    if (!itemTitle.trim()) {
      setFieldErrors((current) => ({
        ...current,
        itemTitle: true,
      }));
      setError("Work item title is required.");
      itemTitleInputRef.current?.focus();
      setBusy(false);
      return;
    }

    if (!Number.isInteger(revision) || revision < 1) {
      setFieldErrors((current) => ({
        ...current,
        revision: true,
      }));
      setError("Revision must be a whole number greater than or equal to 1.");
      setBusy(false);
      return;
    }

    if (!richTextToPlain(bodyMarkdown)) {
      setFieldErrors((current) => ({
        ...current,
        body: true,
      }));
      setError("Instruction steps are required.");
      setBodyFocusRequestKey((current) => current + 1);
      setBusy(false);
      return;
    }

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        throw new Error("You must be signed in.");
      }

      const workItemPayload: {
        id?: string;
        department_id: string;
        part_number: string;
        mold_number: string;
        item_title: string;
        created_by: string;
      } = {
        department_id: normalizedDepartmentId,
        part_number: normalizedPartNumber,
        mold_number: normalizedMoldNumber,
        item_title: itemTitle.trim(),
        created_by: user.id,
      };

      if (workItemId) {
        workItemPayload.id = workItemId;
      }

      const { data: workItem, error: workItemError } = await supabase
        .from("work_items")
        .upsert(workItemPayload, {
          onConflict: "part_number,mold_number,item_title,department_id",
        })
        .select("id")
        .single();

      const typedWorkItem = workItem as { id: string } | null;

      if (workItemError || !typedWorkItem) {
        throw new Error(workItemError?.message ?? "Unable to save work item.");
      }

      if (mode !== "fork") {
        let duplicateCheckRequest = supabase
          .from("work_instructions")
          .select("id")
          .eq("is_archived", false)
          .eq("work_item_id", typedWorkItem.id)
          .limit(1);

        if (mode === "edit" && initialData?.instructionId) {
          duplicateCheckRequest = duplicateCheckRequest.neq("id", initialData.instructionId);
        }

        const { data: duplicateInstruction, error: duplicateCheckError } =
          await duplicateCheckRequest.maybeSingle();

        if (duplicateCheckError) {
          throw new Error(duplicateCheckError.message);
        }

        if (duplicateInstruction) {
          setFieldErrors((current) => ({
            ...current,
            itemTitle: true,
          }));
          itemTitleInputRef.current?.focus();
          throw new Error(
            "A work instruction with this title already exists for this Part/Mold. Open the existing instruction to edit it.",
          );
        }
      }

      let instructionId = initialData?.instructionId ?? "";
      const previousBodyForSummary = initialData?.bodyMarkdown ?? "";
      const previousRevisionForSummary = initialData?.revision ?? revision;
      const changeComputation =
        mode === "edit"
          ? buildInstructionUpdateSummary({
              previousBody: previousBodyForSummary,
              nextBody: bodyMarkdown,
              previousRevision: previousRevisionForSummary,
              nextRevision: revision,
            })
          : {
              summary: buildInstructionCreateSummary(bodyMarkdown, revision),
              sourcePayload: null,
            };
      const changeSummary = changeComputation.summary;
      let changeOccurredAt: string | null = null;
      const changeEventType: "created" | "updated" =
        mode === "edit" ? "updated" : "created";

      if (mode === "create" || mode === "fork") {
        const { data: insertedInstruction, error: insertInstructionError } = await supabase
          .from("work_instructions")
          .insert({
            work_item_id: typedWorkItem.id,
            body_markdown: bodyMarkdown,
            notes_markdown: "",
            revision,
            last_change_summary: changeSummary,
            created_by: user.id,
            updated_by: user.id,
          })
          .select("id, created_at")
          .single();

        const typedInstruction =
          insertedInstruction as { id: string; created_at: string } | null;

        if (insertInstructionError || !typedInstruction) {
          throw new Error(
            insertInstructionError?.message ?? "Unable to create instruction.",
          );
        }

        instructionId = typedInstruction.id;
        changeOccurredAt = typedInstruction.created_at ?? new Date().toISOString();
      } else {
        const { data: updatedInstruction, error: updateInstructionError } = await supabase
          .from("work_instructions")
          .update({
            work_item_id: typedWorkItem.id,
            body_markdown: bodyMarkdown,
            notes_markdown: "",
            revision,
            last_change_summary: changeSummary,
            updated_by: user.id,
          })
          .eq("id", instructionId)
          .select("updated_at")
          .single();

        if (updateInstructionError) {
          throw new Error(updateInstructionError.message);
        }

        const typedUpdatedInstruction =
          updatedInstruction as { updated_at: string } | null;
        changeOccurredAt = typedUpdatedInstruction?.updated_at ?? new Date().toISOString();
      }

      if (changeOccurredAt && changeComputation.sourcePayload) {
        try {
          await supabase.from("instruction_change_events").upsert(
            {
              instruction_id: instructionId,
              actor_user_id: user.id,
              event_type: changeEventType,
              detail: changeSummary,
              revision,
              occurred_at: changeOccurredAt,
              source_payload: changeComputation.sourcePayload,
            },
            {
              onConflict: "instruction_id,event_type,actor_user_id,occurred_at",
            },
          );
        } catch {
          // Capturing source snippets is best-effort and should not block saves.
        }
      }

      setMessage(
        mode === "edit"
          ? "Instruction updated successfully."
          : mode === "fork"
            ? "Instruction fork created successfully."
            : "Instruction created successfully.",
      );

      navigationBypassRef.current = true;
      navigateWithGuardReleased(() => {
        router.push(`/instructions/${instructionId}`);
        router.refresh();
      });
    } catch (caughtError) {
      setError(normalizeSubmissionError(caughtError));
      navigationBypassRef.current = false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-5">
      {message ? (
        <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-200">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-200">
          {error}
        </p>
      ) : null}

      <form
        noValidate
        onSubmit={handleSubmit}
        className="grid min-w-0 gap-5 overflow-hidden rounded-3xl border border-white/30 bg-white/75 p-5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 md:p-7"
      >
        <div className="grid gap-3 md:grid-cols-2 md:gap-4">
          <label className="grid gap-1.5 text-sm">
            <span className="font-semibold">Part #</span>
            <div className="relative">
              <input
                ref={partInputRef}
                value={partNumber}
                placeholder="Example: SK-12345"
                onFocus={() => {
                  if (partSuggestions.length > 0) {
                    setPartSearchOpen(true);
                  }
                }}
                onBlur={() => {
                  window.setTimeout(() => setPartSearchOpen(false), 120);
                }}
                onChange={(event) => {
                  setPartNumber(event.target.value);
                  setPartSearchOpen(true);
                  setWorkItemId(null);
                  if (fieldErrors.partOrMold) {
                    setFieldErrors((current) => ({
                      ...current,
                      partOrMold: false,
                    }));
                  }
                }}
                className={cn(
                  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950",
                  fieldErrors.partOrMold ? "border-rose-500 ring-2 ring-rose-500/30" : "",
                )}
              />
              {partSearchOpen ? (
                <div className="absolute left-0 right-0 top-[calc(100%+0.4rem)] z-20 max-h-60 overflow-auto rounded-xl border border-slate-300 bg-white/95 p-1 shadow-xl backdrop-blur dark:border-slate-700 dark:bg-slate-950/95">
                  {partSearchBusy ? (
                    <p className="px-2 py-2 text-xs text-slate-500 dark:text-slate-300">
                      Searching...
                    </p>
                  ) : partSuggestions.length === 0 ? (
                    <p className="px-2 py-2 text-xs text-slate-500 dark:text-slate-300">
                      No part matches.
                    </p>
                  ) : (
                    partSuggestions.map((result) => (
                      <button
                        key={result.id}
                        type="button"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          applySuggestedWorkItem(result);
                        }}
                        className="grid w-full gap-0.5 rounded-lg px-2 py-1.5 text-left text-xs transition hover:bg-cyan-500/10"
                      >
                        <span className="font-semibold text-slate-800 dark:text-slate-100">
                          {result.part_number}
                        </span>
                        <span className="text-slate-500 dark:text-slate-300">
                          {getDepartmentNameFromRelation(result.departments)} |{" "}
                          {summarizePartMold(result.part_number, result.mold_number)} |{" "}
                          {result.item_title}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          </label>

          <label className="grid gap-1.5 text-sm">
            <span className="font-semibold">Mold #</span>
            <div className="relative">
              <input
                ref={moldInputRef}
                value={moldNumber}
                placeholder="Example: FAL-11"
                onFocus={() => {
                  if (moldSuggestions.length > 0) {
                    setMoldSearchOpen(true);
                  }
                }}
                onBlur={() => {
                  window.setTimeout(() => setMoldSearchOpen(false), 120);
                }}
                onChange={(event) => {
                  setMoldNumber(event.target.value);
                  setMoldSearchOpen(true);
                  setWorkItemId(null);
                  if (fieldErrors.partOrMold) {
                    setFieldErrors((current) => ({
                      ...current,
                      partOrMold: false,
                    }));
                  }
                }}
                className={cn(
                  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950",
                  fieldErrors.partOrMold ? "border-rose-500 ring-2 ring-rose-500/30" : "",
                )}
              />
              {moldSearchOpen ? (
                <div className="absolute left-0 right-0 top-[calc(100%+0.4rem)] z-20 max-h-60 overflow-auto rounded-xl border border-slate-300 bg-white/95 p-1 shadow-xl backdrop-blur dark:border-slate-700 dark:bg-slate-950/95">
                  {moldSearchBusy ? (
                    <p className="px-2 py-2 text-xs text-slate-500 dark:text-slate-300">
                      Searching...
                    </p>
                  ) : moldSuggestions.length === 0 ? (
                    <p className="px-2 py-2 text-xs text-slate-500 dark:text-slate-300">
                      No mold matches.
                    </p>
                  ) : (
                    moldSuggestions.map((result) => (
                      <button
                        key={result.id}
                        type="button"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          applySuggestedWorkItem(result);
                        }}
                        className="grid w-full gap-0.5 rounded-lg px-2 py-1.5 text-left text-xs transition hover:bg-cyan-500/10"
                      >
                        <span className="font-semibold text-slate-800 dark:text-slate-100">
                          {result.mold_number || "N/A"}
                        </span>
                        <span className="text-slate-500 dark:text-slate-300">
                          {getDepartmentNameFromRelation(result.departments)} |{" "}
                          {summarizePartMold(result.part_number, result.mold_number)} |{" "}
                          {result.item_title}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_140px] md:items-end md:gap-4">
          <label className="grid gap-1.5 text-sm">
            <span className="font-semibold">Work Item Title</span>
            <input
              ref={itemTitleInputRef}
              placeholder="Example: Pouring Procedure"
              value={itemTitle}
              onChange={(event) => {
                setItemTitle(event.target.value);
                setWorkItemId(null);
                if (fieldErrors.itemTitle) {
                  setFieldErrors((current) => ({
                    ...current,
                    itemTitle: false,
                  }));
                }
              }}
              className={cn(
                "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950",
                fieldErrors.itemTitle ? "border-rose-500 ring-2 ring-rose-500/30" : "",
              )}
            />
          </label>

          <label className="grid gap-1.5 text-sm">
            <span className="font-semibold">Department</span>
            <select
              value={departmentId}
              onChange={(event) => {
                setDepartmentTouched(true);
                setDepartmentId(event.target.value);
                setWorkItemId(null);
                if (fieldErrors.department) {
                  setFieldErrors((current) => ({
                    ...current,
                    department: false,
                  }));
                }
              }}
              className={cn(
                "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 disabled:cursor-not-allowed dark:border-slate-700 dark:bg-slate-950",
                fieldErrors.department ? "border-rose-500 ring-2 ring-rose-500/30" : "",
              )}
              disabled={departmentsBusy || departments.length === 0}
            >
              {departmentsBusy ? (
                <option value="">Loading...</option>
              ) : departments.length === 0 ? (
                <option value="">No departments configured</option>
              ) : null}
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>

          <label className="grid min-w-0 gap-1.5 text-sm">
            <span className="font-semibold">Revision</span>
            <input
              min={1}
              type="number"
              value={revision}
              onChange={(event) => {
                setRevision(Number.parseInt(event.target.value || "0", 10));
                if (fieldErrors.revision) {
                  setFieldErrors((current) => ({
                    ...current,
                    revision: false,
                  }));
                }
              }}
              className={cn(
                "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950",
                fieldErrors.revision ? "border-rose-500 ring-2 ring-rose-500/30" : "",
              )}
            />
          </label>
        </div>

        <RichTextEditor
          label="Work Instructions"
          value={bodyMarkdown}
          onChange={(nextValue) => {
            setBodyMarkdown(nextValue);
            if (fieldErrors.body && richTextToPlain(nextValue)) {
              setFieldErrors((current) => ({
                ...current,
                body: false,
              }));
            }
          }}
          placeholder="Type work instructions here. Use toolbar buttons for formatting and inline media."
          minHeightClassName="min-h-72"
          hasError={fieldErrors.body}
          focusRequestKey={bodyFocusRequestKey}
        />

        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <UploadCloud size={16} />}
          {mode === "edit"
            ? "Save Changes"
            : mode === "fork"
              ? "Create Fork"
              : "Create Instruction"}
        </button>
      </form>

      {navigationModalOpen && portalReady
        ? createPortal(
            <div className="fixed inset-0 z-[111] flex items-center justify-center overflow-y-auto bg-slate-950/75 p-4 backdrop-blur-sm sm:p-6">
              <div className="grid w-full max-w-md gap-4 rounded-2xl border border-amber-500/45 bg-slate-950/95 p-5 shadow-2xl">
                <div className="grid gap-1">
                  <h3 className="text-lg font-bold text-slate-100">Discard unsaved changes?</h3>
                  <p className="text-sm text-slate-300">
                    You have unsaved changes. If you leave this page now, your updates will be
                    lost.
                  </p>
                </div>

                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={handleCancelNavigationAway}
                    className="rounded-xl border border-slate-600 bg-slate-900/70 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-800"
                  >
                    Keep Editing
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmNavigationAway}
                    className="rounded-xl border border-amber-500/45 bg-amber-500/20 px-4 py-2 text-sm font-semibold text-amber-100 transition hover:bg-amber-500/30"
                  >
                    Leave Without Saving
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {forkCanceledModalOpen && portalReady
        ? createPortal(
            <div className="fixed inset-0 z-[110] flex items-center justify-center overflow-y-auto bg-slate-950/70 p-4 backdrop-blur-sm sm:p-6">
              <div className="grid w-full max-w-md gap-4 rounded-2xl border border-cyan-500/35 bg-slate-950/95 p-5 shadow-2xl max-h-[calc(100vh-2rem)] overflow-y-auto">
                <div className="grid gap-1">
                  <h3 className="text-lg font-bold text-slate-100">Fork canceled</h3>
                  <p className="text-sm text-slate-300">
                    No changes were detected, so a new fork was not created.
                  </p>
                </div>

                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setForkCanceledModalOpen(false)}
                    className="rounded-xl border border-slate-600 bg-slate-900/70 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-800"
                  >
                    Keep Editing
                  </button>

                  {initialData?.sourceInstructionId ? (
                    <button
                      type="button"
                      onClick={() => {
                        setForkCanceledModalOpen(false);
                        navigationBypassRef.current = true;
                        navigateWithGuardReleased(() => {
                          router.push(`/instructions/${initialData.sourceInstructionId}`);
                          router.refresh();
                        });
                      }}
                      className="rounded-xl border border-cyan-500/45 bg-cyan-500/15 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/25"
                    >
                      Back to Instruction
                    </button>
                  ) : null}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
