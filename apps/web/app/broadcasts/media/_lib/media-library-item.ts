export interface BroadcastMediaLibraryAsset {
  readonly id: string;
  readonly url: string;
  readonly filename: string;
  readonly contentType: string;
  readonly kind: "image" | "audio" | "document";
  readonly typeLabel: string;
  readonly sizeBytes: number;
  readonly createdAt: string;
}

type MediaLibraryItemSource = Readonly<{
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}> &
  ({ readonly publicUrl: string } | { readonly url: string });

export function toMediaLibraryItem(
  asset: MediaLibraryItemSource,
): BroadcastMediaLibraryAsset {
  const type = mediaType(asset.contentType);
  return {
    id: asset.id,
    url: "publicUrl" in asset ? asset.publicUrl : asset.url,
    filename: asset.filename,
    contentType: asset.contentType,
    ...type,
    sizeBytes: asset.sizeBytes,
    createdAt: asset.createdAt,
  };
}

function mediaType(contentType: string): Pick<BroadcastMediaLibraryAsset, "kind" | "typeLabel"> {
  switch (contentType) {
    case "image/png": return { kind: "image", typeLabel: "PNG image" };
    case "image/jpeg": return { kind: "image", typeLabel: "JPEG image" };
    case "image/gif": return { kind: "image", typeLabel: "GIF image" };
    case "image/webp": return { kind: "image", typeLabel: "WEBP image" };
    case "audio/mpeg": return { kind: "audio", typeLabel: "MP3 audio" };
    case "audio/mp4": return { kind: "audio", typeLabel: "M4A audio" };
    case "audio/wav": return { kind: "audio", typeLabel: "WAV audio" };
    case "application/pdf": return { kind: "document", typeLabel: "PDF" };
    default: return contentType.startsWith("image/")
      ? { kind: "image", typeLabel: contentType }
      : { kind: "document", typeLabel: contentType };
  }
}
