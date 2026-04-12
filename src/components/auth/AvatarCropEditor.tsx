'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useTranslations } from 'next-intl'

interface Props {
  imageFile: File
  onConfirm: (croppedBlob: Blob) => void
  onCancel: () => void
}

const CANVAS_SIZE = 256
const VIEW_SIZE = 240

const BG_COLORS: { labelKey: string; value: string }[] = [
  { labelKey: 'bgColorDarkNavy', value: '#1a1a2e' },
  { labelKey: 'bgColorBlack', value: '#000000' },
  { labelKey: 'bgColorDarkGray', value: '#2d2d2d' },
  { labelKey: 'bgColorGray', value: '#6b7280' },
  { labelKey: 'bgColorWhite', value: '#ffffff' },
  { labelKey: 'bgColorGreen', value: '#166534' },
  { labelKey: 'bgColorBlue', value: '#1e3a5f' },
  { labelKey: 'bgColorPurple', value: '#3b1f6e' },
  { labelKey: 'bgColorRed', value: '#7f1d1d' },
  { labelKey: 'bgColorBrown', value: '#5c3a1e' },
]

export default function AvatarCropEditor({ imageFile, onConfirm, onCancel }: Props) {
  const tAuth = useTranslations('auth')
  const tc = useTranslations('common')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [bgColor, setBgColor] = useState('#1a1a2e')
  const dragging = useRef(false)
  const lastPos = useRef({ x: 0, y: 0 })

  // 이미지 로드
  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      imgRef.current = img
      // 초기 스케일: 이미지가 원형 영역을 꽉 채우도록
      const minDim = Math.min(img.width, img.height)
      const initScale = VIEW_SIZE / minDim
      setScale(initScale)
      setOffset({
        x: (VIEW_SIZE - img.width * initScale) / 2,
        y: (VIEW_SIZE - img.height * initScale) / 2,
      })
      setLoadError(null)
      setLoaded(true)
    }
    img.onerror = () => {
      setLoadError(tAuth('imageLoadFailed'))
    }
    img.src = URL.createObjectURL(imageFile)
    return () => URL.revokeObjectURL(img.src)
  }, [imageFile])

  // 캔버스에 그리기
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, VIEW_SIZE, VIEW_SIZE)

    // 원형 클리핑
    ctx.save()
    ctx.beginPath()
    ctx.arc(VIEW_SIZE / 2, VIEW_SIZE / 2, VIEW_SIZE / 2, 0, Math.PI * 2)
    ctx.clip()

    // 배경
    ctx.fillStyle = bgColor
    ctx.fillRect(0, 0, VIEW_SIZE, VIEW_SIZE)

    // 이미지
    ctx.drawImage(img, offset.x, offset.y, img.width * scale, img.height * scale)
    ctx.restore()

    // 원형 가이드라인
    ctx.beginPath()
    ctx.arc(VIEW_SIZE / 2, VIEW_SIZE / 2, VIEW_SIZE / 2 - 1, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(74, 222, 128, 0.5)'
    ctx.lineWidth = 2
    ctx.stroke()
  }, [offset, scale, bgColor])

  useEffect(() => {
    if (loaded) draw()
  }, [loaded, draw])

  // 마우스/터치 드래그
  const handlePointerDown = (e: React.PointerEvent) => {
    dragging.current = true
    lastPos.current = { x: e.clientX, y: e.clientY }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return
    const dx = e.clientX - lastPos.current.x
    const dy = e.clientY - lastPos.current.y
    lastPos.current = { x: e.clientX, y: e.clientY }
    setOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }))
  }

  const handlePointerUp = () => {
    dragging.current = false
  }

  // 줌
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.05 : 0.05
    setScale(prev => {
      const next = Math.max(0.1, Math.min(5, prev + delta))
      // 줌 중심을 캔버스 중심으로
      const img = imgRef.current
      if (img) {
        const cx = VIEW_SIZE / 2
        const cy = VIEW_SIZE / 2
        setOffset(prevOff => ({
          x: cx - (cx - prevOff.x) * (next / prev),
          y: cy - (cy - prevOff.y) * (next / prev),
        }))
      }
      return next
    })
  }

  // 확인 - 크롭 결과를 Blob으로 반환
  const handleConfirm = () => {
    try {
      const img = imgRef.current
      if (!img) return
      const outCanvas = document.createElement('canvas')
      outCanvas.width = CANVAS_SIZE
      outCanvas.height = CANVAS_SIZE
      const ctx = outCanvas.getContext('2d')
      if (!ctx) {
        alert(tAuth('canvasInitFailed'))
        return
      }

      // 원형 클리핑
      ctx.beginPath()
      ctx.arc(CANVAS_SIZE / 2, CANVAS_SIZE / 2, CANVAS_SIZE / 2, 0, Math.PI * 2)
      ctx.clip()

      // 배경색
      ctx.fillStyle = bgColor
      ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)

      // VIEW_SIZE → CANVAS_SIZE 비율
      const ratio = CANVAS_SIZE / VIEW_SIZE
      ctx.drawImage(
        img,
        offset.x * ratio,
        offset.y * ratio,
        img.width * scale * ratio,
        img.height * scale * ratio,
      )

      outCanvas.toBlob((blob) => {
        if (!blob) {
          alert(tAuth('imageProcessFailed'))
          return
        }
        onConfirm(blob)
      }, 'image/png', 1)
    } catch {
      alert(tAuth('imageProcessError'))
    }
  }

  // 줌 슬라이더
  const minScale = imgRef.current ? VIEW_SIZE / Math.max(imgRef.current.width, imgRef.current.height) * 0.5 : 0.1
  const maxScale = 5

  if (loadError) {
    return (
      <div className="flex flex-col items-center gap-3">
        <div className="w-full text-center py-6">
          <i className="fa-solid fa-circle-exclamation text-ive-red text-2xl mb-2" />
          <p className="text-sm text-ive-red font-bold">{loadError}</p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="w-full py-2 rounded-lg text-sm font-bold text-ive-text-dim bg-ive-bg-card border border-ive-border-subtle"
        >
          {tAuth('goBack')}
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <p className="text-xs text-ive-text-muted">{tAuth('dragToAdjust')}</p>

      {/* 캔버스 */}
      <div
        className="relative rounded-full overflow-hidden cursor-grab active:cursor-grabbing"
        style={{ width: VIEW_SIZE, height: VIEW_SIZE }}
        onWheel={handleWheel}
      >
        <canvas
          ref={canvasRef}
          width={VIEW_SIZE}
          height={VIEW_SIZE}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={{ touchAction: 'none' }}
        />
      </div>

      {/* 줌 슬라이더 */}
      <div className="flex items-center gap-2 w-full max-w-[240px]">
        <i className="fa-solid fa-magnifying-glass-minus text-xs text-ive-text-dim" />
        <input
          type="range"
          min={minScale}
          max={maxScale}
          step={0.01}
          value={scale}
          onChange={(e) => {
            const next = Number(e.target.value)
            const img = imgRef.current
            if (img) {
              const cx = VIEW_SIZE / 2
              const cy = VIEW_SIZE / 2
              setOffset(prevOff => ({
                x: cx - (cx - prevOff.x) * (next / scale),
                y: cy - (cy - prevOff.y) * (next / scale),
              }))
            }
            setScale(next)
          }}
          className="flex-1 accent-ive-green h-1"
        />
        <i className="fa-solid fa-magnifying-glass-plus text-xs text-ive-text-dim" />
      </div>

      {/* 배경색 */}
      <div className="w-full max-w-[240px]">
        <p className="text-xs text-ive-text-dim mb-1.5">{tAuth('backgroundColor')}</p>
        <div className="flex gap-1.5 flex-wrap justify-center">
          {BG_COLORS.map(c => (
            <button
              key={c.value}
              type="button"
              title={tAuth(c.labelKey)}
              onClick={() => setBgColor(c.value)}
              className={`w-6 h-6 rounded-full border-2 transition-all ${
                bgColor === c.value ? 'border-ive-green scale-125' : 'border-ive-border-subtle hover:scale-110'
              }`}
              style={{ backgroundColor: c.value }}
            />
          ))}
        </div>
      </div>

      {/* 버튼 */}
      <div className="flex gap-2 w-full">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-2 rounded-lg text-sm font-bold text-ive-text-dim bg-ive-bg-card border border-ive-border-subtle"
        >
          {tc('cancel')}
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          className="flex-1 py-2 rounded-lg text-sm font-bold text-white bg-ive-green"
        >
          {tc('confirm')}
        </button>
      </div>
    </div>
  )
}
