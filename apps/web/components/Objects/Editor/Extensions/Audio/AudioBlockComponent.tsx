import { NodeViewProps, NodeViewWrapper } from '@tiptap/react'
import { Node } from '@tiptap/core'
import {
  CircleNotch, Headphones, UploadSimple, X, ArrowsLeftRight,
  CheckCircle, WarningCircle, Radio, Sparkle
} from '@phosphor-icons/react'
import React from 'react'
import toast from 'react-hot-toast'
import { uploadNewAudioFile, generateAudioBlock, generateScript } from '../../../../../services/blocks/Audio/audio'
import { getAudioBlockStreamUrl } from '@services/media/media'
import { useOrg } from '@components/Contexts/OrgContext'
import { useCourse } from '@components/Contexts/CourseContext'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { constructAcceptValue } from '@/lib/constants'
import { cn } from '@/lib/utils'
import InlineAudioPlayer from '@components/Objects/Media/InlineAudioPlayer'

const SUPPORTED_FILES = constructAcceptValue(['mp3', 'wav', 'ogg', 'm4a'])

const AUDIO_SIZES = {
  small: { maxWidth: 400, label: 'Small' },
  medium: { maxWidth: 600, label: 'Medium' },
  large: { maxWidth: 800, label: 'Large' },
  full: { maxWidth: '100%', label: 'Full Width' },
} as const

type AudioSize = keyof typeof AUDIO_SIZES
type SourceType = 'upload'
type TabType = 'upload' | 'generate'

// AI audio generation (Gemini TTS). Curated subset of the prebuilt voices, and a
// list of well-supported languages. Language is otherwise auto-detected from the
// text; picking one just nudges the model.
const AI_CREDIT_COST = 3
const SCRIPT_CREDIT_COST = 1
const TTS_VOICES = [
  { name: 'Kore', desc: 'Firm' },
  { name: 'Puck', desc: 'Upbeat' },
  { name: 'Zephyr', desc: 'Bright' },
  { name: 'Charon', desc: 'Informative' },
  { name: 'Aoede', desc: 'Breezy' },
  { name: 'Achird', desc: 'Friendly' },
  { name: 'Sulafat', desc: 'Warm' },
  { name: 'Enceladus', desc: 'Breathy' },
  { name: 'Leda', desc: 'Youthful' },
  { name: 'Sadaltager', desc: 'Knowledgeable' },
]
const TTS_LANGUAGES = [
  'Auto-detect', 'English', 'Spanish', 'French', 'German', 'Portuguese',
  'Italian', 'Dutch', 'Arabic', 'Hindi', 'Japanese', 'Korean',
  'Chinese (Mandarin)', 'Russian', 'Turkish', 'Polish', 'Indonesian', 'Vietnamese',
]
// Approximate talk length options, in minutes (from 2).
const LENGTH_OPTIONS = [2, 3, 5, 10]

type GenMode = 'tts' | 'speak'

interface AudioBlockObject {
  block_uuid?: string
  source_type: SourceType
  content?: {
    file_id: string
    file_format: string
    activity_uuid?: string
  }
  size: AudioSize
}

interface Organization {
  org_uuid: string
}

interface Course {
  courseStructure: {
    course_uuid: string
  }
}

interface EditorState {
  isEditable: boolean
}

interface Session {
  data?: {
    tokens?: {
      access_token?: string
    }
  }
}

interface ExtendedNodeViewProps extends Omit<NodeViewProps, 'extension'> {
  extension: Node & {
    options: {
      activity: {
        activity_uuid: string
      }
    }
  }
}


// ─── Main AudioBlockComponent ───

function AudioBlockComponent(props: ExtendedNodeViewProps) {
  const { node, extension, updateAttributes } = props
  const org = useOrg() as Organization | null
  const course = useCourse() as Course | null
  const editorState = useEditorProvider() as EditorState
  const session = useLHSession() as Session

  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const uploadZoneRef = React.useRef<HTMLDivElement>(null)

  const [blockObject, setBlockObject] = React.useState<AudioBlockObject | null>(
    node.attrs.blockObject || null
  )
  const [selectedSize, setSelectedSize] = React.useState<AudioSize>(
    node.attrs.blockObject?.size || 'medium'
  )
  const [activeTab, setActiveTab] = React.useState<TabType>('upload')
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [isDragging, setIsDragging] = React.useState(false)
  const [uploadProgress, setUploadProgress] = React.useState(0)

  // AI generation state
  const [genMode, setGenMode] = React.useState<GenMode>('tts')
  const [genText, setGenText] = React.useState('')
  const [genVoice, setGenVoice] = React.useState(TTS_VOICES[0].name)
  const [genLanguage, setGenLanguage] = React.useState(TTS_LANGUAGES[0])
  const [genStyle, setGenStyle] = React.useState('')
  const [genMinutes, setGenMinutes] = React.useState<number>(LENGTH_OPTIONS[0])
  const [isGenerating, setIsGenerating] = React.useState(false)
  const [isGeneratingScript, setIsGeneratingScript] = React.useState(false)

  const isEditable = editorState?.isEditable
  const access_token = session?.data?.tokens?.access_token

  // Update block object when size changes
  React.useEffect(() => {
    if (blockObject && blockObject.size !== selectedSize) {
      const newBlockObject = { ...blockObject, size: selectedSize }
      setBlockObject(newBlockObject)
      updateAttributes({ blockObject: newBlockObject })
    }
  }, [selectedSize])

  const handleAudioChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      setError(null)
      handleUpload(file)
    }
  }

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.currentTarget === uploadZoneRef.current) setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    const ext = file?.name.split('.').pop()?.toLowerCase()
    if (file && ext && ['mp3', 'wav', 'ogg', 'm4a'].includes(ext)) {
      setError(null)
      handleUpload(file)
    } else {
      setError('Please upload a supported audio format (MP3, WAV, OGG, or M4A)')
    }
  }

  const handleUpload = async (file: File) => {
    if (!access_token) return
    try {
      setIsLoading(true)
      setError(null)
      setUploadProgress(0)
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => Math.min(prev + 10, 90))
      }, 200)
      const object = await uploadNewAudioFile(file, extension.options.activity.activity_uuid, access_token)
      clearInterval(progressInterval)
      setUploadProgress(100)
      const newBlockObject: AudioBlockObject = { ...object, source_type: 'upload', size: selectedSize }
      setBlockObject(newBlockObject)
      updateAttributes({ blockObject: newBlockObject })
      setTimeout(() => setUploadProgress(0), 1000)
    } catch (err: any) {
      const errorMessage = err?.message || 'Failed to upload audio. Please try again.'
      setError(errorMessage)
      toast.error(errorMessage)
    } finally {
      setIsLoading(false)
    }
  }

  const handleGenerate = async () => {
    if (!access_token) return
    if (!genText.trim()) {
      setError('Write some text to generate audio from.')
      return
    }
    try {
      setIsGenerating(true)
      setError(null)
      // 'speak' narrates a single voice, same as plain text-to-speech.
      const object = await generateAudioBlock(
        {
          activity_uuid: extension.options.activity.activity_uuid,
          mode: 'tts',
          text: genText,
          voice: genVoice,
          style: genStyle.trim() || undefined,
          language: genLanguage === 'Auto-detect' ? undefined : genLanguage,
        },
        access_token
      )
      // Generated audio is stored like an upload, so treat it identically.
      const newBlockObject: AudioBlockObject = { ...object, source_type: 'upload', size: selectedSize }
      setBlockObject(newBlockObject)
      updateAttributes({ blockObject: newBlockObject })
      toast.success('Audio generated')
    } catch (err: any) {
      const errorMessage = err?.message || 'Failed to generate audio. Please try again.'
      setError(errorMessage)
      toast.error(errorMessage)
    } finally {
      setIsGenerating(false)
    }
  }

  const handleGenerateScript = async () => {
    if (!access_token) return
    if (!genText.trim()) {
      setError('Add a topic or some text to generate a script from.')
      return
    }
    try {
      setIsGeneratingScript(true)
      setError(null)
      const res = await generateScript(
        {
          activity_uuid: extension.options.activity.activity_uuid,
          mode: 'speak',
          text: genText,
          style: genStyle.trim() || undefined,
          language: genLanguage === 'Auto-detect' ? undefined : genLanguage,
          minutes: genMinutes,
        },
        access_token
      )
      if (res?.transcript) {
        setGenText(res.transcript)
        toast.success('Script ready. Review it, then generate audio')
      }
    } catch (err: any) {
      const errorMessage = err?.message || 'Failed to generate script. Please try again.'
      setError(errorMessage)
      toast.error(errorMessage)
    } finally {
      setIsGeneratingScript(false)
    }
  }

  const handleRemove = () => {
    setBlockObject(null)
    updateAttributes({ blockObject: null })
    setError(null)
    setUploadProgress(0)
  }

  // Build audio URLs
  const uploadAudioUrl =
    blockObject?.source_type === 'upload' && blockObject.content && org?.org_uuid && course?.courseStructure.course_uuid
      ? getAudioBlockStreamUrl(
          org.org_uuid,
          course.courseStructure.course_uuid,
          blockObject.content.activity_uuid || extension.options.activity.activity_uuid,
          blockObject.block_uuid || '',
          `${blockObject.content.file_id}.${blockObject.content.file_format}`
        )
      : null

  const getMaxWidth = (size: AudioSize) => {
    const mw = AUDIO_SIZES[size].maxWidth
    return typeof mw === 'number' ? mw : '100%'
  }

  // ===== PREVIEW MODE =====
  if (!isEditable) {
    if (!blockObject) return null
    const maxWidth = getMaxWidth(blockObject.size || 'medium')

    return (
      <NodeViewWrapper className="block-audio w-full">
        <div className="w-full flex justify-center my-4">
          <div style={{ maxWidth, width: '100%' }}>
            {blockObject.source_type === 'upload' && uploadAudioUrl && (
              <InlineAudioPlayer src={uploadAudioUrl} />
            )}
          </div>
        </div>
      </NodeViewWrapper>
    )
  }

  // ===== EDIT MODE =====
  return (
    <NodeViewWrapper className="block-audio w-full">
      <div className="bg-neutral-50 rounded-xl px-5 py-4 nice-shadow transition-all ease-linear">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Headphones weight="duotone" className="text-neutral-400" size={16} />
            <span className="uppercase tracking-widest text-xs font-bold text-neutral-400">Audio</span>
          </div>
          {blockObject && (
            <button onClick={handleRemove} className="text-neutral-400 hover:text-red-500 transition-colors">
              <X weight="duotone" size={16} />
            </button>
          )}
        </div>

        {/* Selection UI (no block object yet) */}
        {!blockObject && (
          <div className="space-y-4">
            {/* Tabs */}
            <div className="flex gap-1 bg-neutral-100 rounded-lg p-1">
              {([
                { key: 'upload' as TabType, icon: UploadSimple, label: 'Upload' },
                { key: 'generate' as TabType, icon: Sparkle, label: 'Generate' },
              ]).map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors flex-1 justify-center outline-none',
                    activeTab === tab.key
                      ? 'bg-white text-neutral-800 shadow-sm'
                      : 'text-neutral-500 hover:text-neutral-700'
                  )}
                >
                  <tab.icon size={14} />
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Upload Tab */}
            {activeTab === 'upload' && (
              <div className="space-y-3">
                <input ref={fileInputRef} type="file" onChange={handleAudioChange} accept={SUPPORTED_FILES} className="hidden" />
                <div
                  ref={uploadZoneRef}
                  onClick={() => fileInputRef.current?.click()}
                  onDragEnter={handleDragEnter}
                  onDragOver={handleDragEnter}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={cn(
                    'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-all',
                    isDragging ? 'border-blue-400 bg-blue-50' : 'border-neutral-200 bg-white hover:border-blue-400 hover:bg-blue-50/50'
                  )}
                >
                  {isLoading ? (
                    <div className="space-y-3">
                      <CircleNotch weight="duotone" className="w-8 h-8 animate-spin mx-auto text-blue-500" />
                      <p className="text-sm text-neutral-600">Uploading... {uploadProgress}%</p>
                      <div className="w-48 h-1 bg-neutral-200 rounded-full mx-auto overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full transition-all duration-200" style={{ width: `${uploadProgress}%` }} />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <UploadSimple weight="duotone" className="w-8 h-8 mx-auto text-neutral-400" />
                      <div>
                        <p className="text-sm font-medium text-neutral-700">Drop an audio file or click to browse</p>
                        <p className="text-xs text-neutral-500 mt-1">Supports MP3, WAV, OGG, M4A</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Generate Tab (AI / Gemini TTS) */}
            {activeTab === 'generate' && (
              <div className="space-y-3">
                {/* Mode toggle */}
                <div className="flex gap-1 bg-neutral-100 rounded-lg p-1">
                  {([
                    { key: 'tts' as const, icon: Sparkle, label: 'Text to speech' },
                    { key: 'speak' as const, icon: Radio, label: 'Speak' },
                  ]).map((m) => (
                    <button
                      key={m.key}
                      onClick={() => setGenMode(m.key)}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors flex-1 justify-center outline-none',
                        genMode === m.key ? 'bg-white text-neutral-800 shadow-sm' : 'text-neutral-500 hover:text-neutral-700'
                      )}
                    >
                      <m.icon size={13} />
                      {m.label}
                    </button>
                  ))}
                </div>

                {/* Script / text */}
                <textarea
                  value={genText}
                  onChange={(e) => setGenText(e.target.value)}
                  rows={genMode === 'tts' ? 4 : 5}
                  placeholder={
                    genMode === 'speak'
                      ? "What should the talk be about? e.g. “Explain how photosynthesis works, in detail.” Then generate a script."
                      : 'Type the text you want spoken aloud…'
                  }
                  className="w-full rounded-lg border border-neutral-200 p-3 text-sm outline-none focus:border-blue-400 resize-y"
                />

                <label className="block">
                  <span className="text-xs font-medium text-neutral-600">Voice</span>
                  <select
                    value={genVoice}
                    onChange={(e) => setGenVoice(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-neutral-200 p-2 text-sm outline-none focus:border-blue-400 bg-white"
                  >
                    {TTS_VOICES.map((v) => (
                      <option key={v.name} value={v.name}>{v.name}: {v.desc}</option>
                    ))}
                  </select>
                </label>

                {/* Length (speak) + language + tone */}
                <div className="flex gap-2">
                  {genMode !== 'tts' && (
                    <label className="w-28 shrink-0">
                      <span className="text-xs font-medium text-neutral-600">Length</span>
                      <select
                        value={genMinutes}
                        onChange={(e) => setGenMinutes(Number(e.target.value))}
                        className="mt-1 w-full rounded-lg border border-neutral-200 p-2 text-sm outline-none focus:border-blue-400 bg-white"
                      >
                        {LENGTH_OPTIONS.map((m) => (
                          <option key={m} value={m}>{m} min</option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label className="flex-1">
                    <span className="text-xs font-medium text-neutral-600">Language</span>
                    <select
                      value={genLanguage}
                      onChange={(e) => setGenLanguage(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-neutral-200 p-2 text-sm outline-none focus:border-blue-400 bg-white"
                    >
                      {TTS_LANGUAGES.map((l) => (
                        <option key={l} value={l}>{l}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex-1">
                    <span className="text-xs font-medium text-neutral-600">Tone / style</span>
                    <input
                      value={genStyle}
                      onChange={(e) => setGenStyle(e.target.value)}
                      placeholder="warm and upbeat"
                      className="mt-1 w-full rounded-lg border border-neutral-200 p-2 text-sm outline-none focus:border-blue-400"
                    />
                  </label>
                </div>

                {/* Speak: turn the topic into a script first */}
                {genMode !== 'tts' && (
                  <button
                    onClick={handleGenerateScript}
                    disabled={isGeneratingScript || isGenerating || !genText.trim()}
                    className={cn(
                      'w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold border transition-colors',
                      isGeneratingScript || isGenerating || !genText.trim()
                        ? 'border-neutral-200 text-neutral-400 cursor-not-allowed'
                        : 'border-neutral-300 text-neutral-700 hover:bg-neutral-50'
                    )}
                  >
                    {isGeneratingScript ? (
                      <><CircleNotch size={15} className="animate-spin" /> Writing the talk…</>
                    ) : (
                      <><Sparkle size={15} /> Generate talk script</>
                    )}
                  </button>
                )}

                {/* Generate audio button */}
                <button
                  onClick={handleGenerate}
                  disabled={isGenerating || isGeneratingScript || !genText.trim()}
                  className={cn(
                    'w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-colors',
                    isGenerating || isGeneratingScript || !genText.trim()
                      ? 'bg-neutral-200 text-neutral-400 cursor-not-allowed'
                      : 'bg-black text-white hover:bg-neutral-800'
                  )}
                >
                  {isGenerating ? (
                    <><CircleNotch size={15} className="animate-spin" /> Generating…</>
                  ) : (
                    <><Sparkle size={15} /> Generate audio</>
                  )}
                </button>
                <p className="text-[11px] text-center text-neutral-400">
                  {genMode !== 'tts'
                    ? `Script ${SCRIPT_CREDIT_COST} credit · Audio ${AI_CREDIT_COST} credits · Powered by Gemini`
                    : `Uses ${AI_CREDIT_COST} AI credits · Powered by Gemini`}
                </p>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 text-sm text-red-500 font-medium bg-red-50 rounded-lg p-3">
                <WarningCircle weight="duotone" size={16} />
                {error}
              </div>
            )}
          </div>
        )}

        {/* Block exists: preview + controls */}
        {blockObject && (
          <div className="space-y-4">
            {/* Size Controls */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="text-sm text-neutral-500 font-medium flex items-center gap-1">
                <ArrowsLeftRight weight="duotone" size={14} />
                Size:
              </div>
              {(Object.keys(AUDIO_SIZES) as AudioSize[]).map((size) => (
                <button
                  key={size}
                  onClick={() => setSelectedSize(size)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors outline-none',
                    selectedSize === size
                      ? 'bg-neutral-700 text-white'
                      : 'bg-neutral-200 text-neutral-700 hover:bg-neutral-300'
                  )}
                >
                  {size === selectedSize && <CheckCircle weight="duotone" size={14} />}
                  {AUDIO_SIZES[size].label}
                </button>
              ))}
            </div>

            {/* Audio Preview */}
            <div className="flex justify-center">
              <div style={{ maxWidth: getMaxWidth(selectedSize), width: '100%' }}>
                {blockObject.source_type === 'upload' && uploadAudioUrl && (
                  <InlineAudioPlayer src={uploadAudioUrl} />
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </NodeViewWrapper>
  )
}

export default AudioBlockComponent
