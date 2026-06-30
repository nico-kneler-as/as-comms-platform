export interface BroadcastMediaLibraryAsset {
  readonly id: string;
  readonly url: string;
  readonly filename: string;
  readonly contentType: string;
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
  return {
    id: asset.id,
    url: "publicUrl" in asset ? asset.publicUrl : asset.url,
    filename: asset.filename,
    contentType: asset.contentType,
    sizeBytes: asset.sizeBytes,
    createdAt: asset.createdAt,
  };
}
