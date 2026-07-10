import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  canEncodeVideo,
} from 'mediabunny'

export type CompressOptions = {
  maxWidth?: number
  maxHeight?: number
  videoBitrate?: number
  audioBitrate?: number
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

const DEFAULTS = {
  maxWidth: 1280,
  maxHeight: 720,
  videoBitrate: 2_000_000, // ~15MB per minute
  audioBitrate: 128_000,
} satisfies Omit<CompressOptions, 'onProgress' | 'signal'>

export async function canCompress(): Promise<boolean> {
  if (typeof VideoEncoder === 'undefined') return false
  return canEncodeVideo('avc')
}

/**
 * Re-encodes a video to 720p H.264/AAC so it fits under the upload limit.
 * Returns the original file unchanged if re-encoding isn't possible or doesn't
 * make it smaller. Audio is preserved.
 */
export async function compressVideo(file: File, opts: CompressOptions = {}): Promise<File> {
  const { maxWidth, maxHeight, videoBitrate, audioBitrate } = { ...DEFAULTS, ...opts }
  if (!(await canCompress())) return file

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }), // moov up front so the CDN can stream it
    target: new BufferTarget(),
  })

  const track = await input.getPrimaryVideoTrack()
  if (!track) return file

  const [srcWidth, srcHeight] = await Promise.all([track.getDisplayWidth(), track.getDisplayHeight()])

  const conversion = await Conversion.init({
    input,
    output,
    video: {
      ...fitWithin(srcWidth, srcHeight, maxWidth, maxHeight),
      codec: 'avc',
      bitrate: videoBitrate,
    },
    audio: { codec: 'aac', bitrate: audioBitrate },
  })

  if (!conversion.isValid) return file

  if (opts.onProgress) conversion.onProgress = (p) => opts.onProgress!(p)
  opts.signal?.addEventListener('abort', () => void conversion.cancel(), { once: true })

  await conversion.execute()

  const buffer = (output.target as BufferTarget).buffer
  if (!buffer) return file

  const compressed = new File([buffer], swapExt(file.name, '.mp4'), { type: 'video/mp4' })

  // Re-encoding an already-efficient file can make it larger. Keep the smaller one.
  return compressed.size < file.size ? compressed : file
}

/** Scales down to fit the box, never up. H.264 requires even dimensions. */
function fitWithin(w: number, h: number, maxW: number, maxH: number) {
  const scale = Math.min(maxW / w, maxH / h, 1)
  return {
    width: Math.round((w * scale) / 2) * 2,
    height: Math.round((h * scale) / 2) * 2,
  }
}

function swapExt(name: string, ext: string): string {
  return name.replace(/\.[^.]+$/, '') + ext
}
