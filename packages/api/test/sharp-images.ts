/**
 * An Images binding made with sharp, for tests that need what the local emulator ignores: `flip`
 * and `trim` (rotate-and-crop edits). Each transform runs as its own step, in order, as Images does.
 * `draw` is ignored, as in the emulator.
 */
import sharp from 'sharp'

type Step = ImageTransform

async function bytesOf(stream: ReadableStream): Promise<Buffer> {
  return Buffer.from(await new Response(stream).arrayBuffer())
}

async function apply(input: Buffer, steps: Step[]): Promise<Buffer> {
  // As Images: the picture the right way up first (EXIF orientation).
  let buffer = await sharp(input).rotate().toBuffer()
  for (const step of steps) {
    let image = sharp(buffer)
    if (step.rotate) image = image.rotate(step.rotate)
    if (step.flip === 'h' || step.flip === 'hv') image = image.flop()
    if (step.flip === 'v' || step.flip === 'hv') image = image.flip()
    if (step.trim && typeof step.trim === 'object') {
      const { left = 0, top = 0, width, height } = step.trim
      const meta = await sharp(buffer).metadata()
      image = image.extract({ left, top, width: width ?? meta.width! - left, height: height ?? meta.height! - top })
    }
    if (step.width || step.height) image = image.resize({ width: step.width, height: step.height, fit: 'inside', withoutEnlargement: true })
    buffer = await image.toBuffer()
  }
  return buffer
}

class Transformer {
  readonly steps: Step[] = []
  constructor(private readonly input: ReadableStream) {}
  transform(step: Step) {
    this.steps.push(step)
    return this
  }
  draw() {
    return this
  }
  async output(options: { format: string; quality?: number }) {
    const pixels = await apply(await bytesOf(this.input), this.steps)
    const format = options.format.replace('image/', '') as 'jpeg' | 'png' | 'webp' | 'avif'
    const bytes = await sharp(pixels).toFormat(format, options.quality ? { quality: options.quality } : {}).toBuffer()
    return {
      response: () => new Response(new Uint8Array(bytes), { headers: { 'Content-Type': options.format } }),
      contentType: () => options.format,
      image: () => new Blob([new Uint8Array(bytes)]).stream(),
    }
  }
}

export function sharpImages(): ImagesBinding {
  return {
    input: (stream: ReadableStream) => new Transformer(stream),
    async info(stream: ReadableStream) {
      const buffer = await bytesOf(stream)
      const meta = await sharp(buffer).rotate().metadata()
      const turned = (meta.orientation ?? 1) >= 5
      return { format: `image/${meta.format}`, fileSize: buffer.byteLength, width: turned ? meta.height! : meta.width!, height: turned ? meta.width! : meta.height! }
    },
  } as unknown as ImagesBinding
}
