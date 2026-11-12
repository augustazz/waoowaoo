'use client'

import { DEFAULT_PROJECT_VIDEO_RATIO } from '@/lib/projects/video-ratio'

/**
 * 首页 - 创作中心
 * 用户登录后的主入口页面：快速创作 + 最近项目
 */
import { useState, useEffect, useLayoutEffect, useCallback, useRef, type ClipboardEvent } from 'react'
import { useSession } from 'next-auth/react'
import { useNow, useTranslations } from 'next-intl'
import Navbar from '@/components/Navbar'
import { BrandPageLoading } from '@/components/ui/BrandLoading'
import { AppIcon, IconGradientDefs } from '@/components/ui/icons'
import StoryInputComposer from '@/components/story-input/StoryInputComposer'
import TypewriterHero from '@/components/home/TypewriterHero'
import {
  PendingMediaFileChips,
  TextAttachmentChips,
  type PendingMediaFileChip,
} from '@/components/project-assistant/AttachmentChips'
import { useAttachmentFilePicker } from '@/components/project-assistant/useAttachmentFilePicker'
import { Link, useRouter } from '@/i18n/navigation'
import { apiFetch } from '@/lib/api-fetch'
import { submitHomeQuickStartLaunch } from '@/lib/home/quick-start-submit'
import { formatDefaultProjectTimestamp } from '@/lib/projects/default-name'
import { HOME_QUICK_START_MIN_ROWS } from '@/lib/ui/textarea-height'
import {
  PROJECT_ASSISTANT_TEXT_ATTACHMENT_ACCEPT,
  PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_FILES,
  type ProjectAssistantTextAttachment,
} from '@/lib/project-agent/text-attachments'
import {
  uploadProjectAssistantTextAttachment,
  validateProjectAssistantTextAttachmentFile,
} from '@/lib/project-agent/text-attachments/client'
import {
  PROJECT_ASSISTANT_MEDIA_ATTACHMENT_ACCEPT,
  PROJECT_ASSISTANT_MEDIA_ATTACHMENT_MAX_FILES,
} from '@/lib/project-agent/media-attachments'
import {
  isProjectAssistantMediaFile,
  validateProjectAssistantMediaAttachmentFile,
} from '@/lib/project-agent/media-attachments/client'
import { readClientApiError } from '@/lib/errors/client'
import { useClientErrorMessage } from '@/hooks/useClientErrorMessage'
import { useToast } from '@/contexts/ToastContext'

interface PendingHomeMediaFile extends PendingMediaFileChip {
  readonly file: File
}

interface ProjectStats {
  resources: number
  folders: number
  images: number
  videos: number
}

interface Project {
  id: string
  name: string
  description: string | null
  createdAt: string
  updatedAt: string
  stats?: ProjectStats
}

const RECENT_COUNT = 5

export default function HomePage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const t = useTranslations('home')
  const now = useNow({ updateInterval: 60_000 })
  const ta = useTranslations('assistantAgent')
  const resolveClientError = useClientErrorMessage()
  const { showError } = useToast()

  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [inputValue, setInputValue] = useState('')
  const [attachments, setAttachments] = useState<ProjectAssistantTextAttachment[]>([])
  const [pendingMediaFiles, setPendingMediaFiles] = useState<PendingHomeMediaFile[]>([])
  const [attachUploading, setAttachUploading] = useState(false)
  const [attachError, setAttachError] = useState<string | null>(null)
  const [createLoading, setCreateLoading] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Object URLs power the local image previews; revoke them on unmount.
  const pendingMediaFilesRef = useRef(pendingMediaFiles)
  useLayoutEffect(() => { pendingMediaFilesRef.current = pendingMediaFiles }, [pendingMediaFiles])
  useEffect(() => () => {
    for (const pending of pendingMediaFilesRef.current) {
      if (pending.previewUrl) URL.revokeObjectURL(pending.previewUrl)
    }
  }, [])

  // 鉴权
  useEffect(() => {
    if (status === 'loading') return
    if (!session) {
      router.push({ pathname: '/auth/signin' })
    }
  }, [session, status, router])

  // 获取最近项目
  const fetchRecentProjects = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams({
        page: '1',
        pageSize: RECENT_COUNT.toString(),
      })
      const response = await apiFetch(`/api/projects?${params}`)
      if (!response.ok) throw await readClientApiError(response)
      const data = await response.json()
      setProjects(data.projects)
    } catch (error) {
      showError(error, t('projectsLoadFailed'))
    } finally {
      setLoading(false)
    }
  }, [showError, t])

  useEffect(() => {
    if (session) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- The request owns its loading state, including the initial fetch.
      void fetchRecentProjects()
    }
  }, [session, fetchRecentProjects])

  // 创建项目并跳转
  const handleCreate = async () => {
    await submitHomeQuickStartLaunch({
      inputValue,
      videoRatio: DEFAULT_PROJECT_VIDEO_RATIO,
      attachments,
      mediaFiles: pendingMediaFiles.map((pending) => pending.file),
      isSubmitting: createLoading,
      apiFetch,
      projectName: t('defaultProjectName', {
        timestamp: formatDefaultProjectTimestamp(new Date()),
      }),
      setSubmitting: setCreateLoading,
      setError: setCreateError,
      navigate: (target) => {
        router.push(target)
      },
      resolveErrorMessage: (error) => resolveClientError(error, t('createFailed')),
    })
  }

  const handleAttachmentUploaded = useCallback((attachment: ProjectAssistantTextAttachment) => {
    setAttachments((current) => {
      if (current.length >= PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_FILES) return current
      return [...current, attachment]
    })
    if (createError) {
      setCreateError(null)
    }
  }, [createError])

  const handleRemoveAttachment = useCallback((attachmentId: string) => {
    setAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId))
  }, [])

  const addPendingMediaFiles = useCallback((files: readonly File[]) => {
    const validationCode = files
      .map(validateProjectAssistantMediaAttachmentFile)
      .find((code) => code !== null)
    if (validationCode) {
      setAttachError(resolveClientError(new Error(validationCode), ta('attachments.mediaUploadFailed')))
      return
    }
    if (files.length + pendingMediaFiles.length > PROJECT_ASSISTANT_MEDIA_ATTACHMENT_MAX_FILES) {
      setAttachError(resolveClientError(new Error('PROJECT_ASSISTANT_MEDIA_ATTACHMENTS_TOO_MANY'), ta('attachments.mediaUploadFailed')))
      return
    }
    setPendingMediaFiles((current) => {
      const room = PROJECT_ASSISTANT_MEDIA_ATTACHMENT_MAX_FILES - current.length
      if (room <= 0) return current
      const added = files.slice(0, room).map((file) => {
        const isImage = file.type.toLowerCase().startsWith('image/')
          || /\.(png|jpe?g|webp)$/i.test(file.name)
        return {
          id: crypto.randomUUID(),
          file,
          fileName: file.name || 'upload',
          isImage,
          previewUrl: isImage ? URL.createObjectURL(file) : null,
        } satisfies PendingHomeMediaFile
      })
      return [...current, ...added]
    })
    if (createError) {
      setCreateError(null)
    }
  }, [createError, pendingMediaFiles.length, resolveClientError, ta])

  const handleRemovePendingMediaFile = useCallback((id: string) => {
    setPendingMediaFiles((current) => {
      const removed = current.find((pending) => pending.id === id)
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl)
      return current.filter((pending) => pending.id !== id)
    })
  }, [])

  const handleComposerPaste = useCallback((event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (createLoading) return
    const files = Array.from(event.clipboardData?.files ?? []).filter(isProjectAssistantMediaFile)
    if (files.length === 0) return
    event.preventDefault()
    addPendingMediaFiles(files)
  }, [addPendingMediaFiles, createLoading])

  // Picker files route by kind: media stays local until the project exists,
  // text files parse immediately through the text-attachment endpoint.
  const handlePickedFiles = useCallback(async (files: readonly File[]) => {
    setAttachError(null)
    const mediaFiles = files.filter(isProjectAssistantMediaFile)
    if (mediaFiles.length > 0) addPendingMediaFiles(mediaFiles)
    const textFiles = files.filter((file) => !isProjectAssistantMediaFile(file))
    if (textFiles.length === 0) return
    const validationCode = textFiles
      .map(validateProjectAssistantTextAttachmentFile)
      .find((code) => code !== null)
    if (validationCode) {
      setAttachError(resolveClientError(new Error(validationCode), ta('attachments.mediaUploadFailed')))
      return
    }
    if (textFiles.length + attachments.length > PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_FILES) {
      setAttachError(resolveClientError(new Error('PROJECT_ASSISTANT_TEXT_ATTACHMENTS_TOO_MANY'), ta('attachments.mediaUploadFailed')))
      return
    }
    setAttachUploading(true)
    try {
      for (const file of textFiles) {
        const attachment = await uploadProjectAssistantTextAttachment({ file })
        handleAttachmentUploaded(attachment)
      }
    } catch (error) {
      setAttachError(resolveClientError(error, ta('attachments.mediaUploadFailed')))
    } finally {
      setAttachUploading(false)
    }
  }, [addPendingMediaFiles, attachments.length, handleAttachmentUploaded, resolveClientError, ta])

  const attachmentPicker = useAttachmentFilePicker({
    accept: `${PROJECT_ASSISTANT_TEXT_ATTACHMENT_ACCEPT},${PROJECT_ASSISTANT_MEDIA_ATTACHMENT_ACCEPT}`,
    disabled: createLoading,
    onFiles: (files) => { void handlePickedFiles(files) },
  })

  const createDisabled = (
    !inputValue.trim() && attachments.length === 0 && pendingMediaFiles.length === 0
  ) || createLoading

  // 时间格式化
  const formatTimeAgo = (dateString: string): string => {
    const diffMs = now.getTime() - new Date(dateString).getTime()
    const diffMinutes = Math.floor(diffMs / (1000 * 60))
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    if (diffMinutes < 1) return t('ago.justNow')
    if (diffMinutes < 60) return t('ago.minutesAgo', { n: diffMinutes })
    if (diffHours < 24) return t('ago.hoursAgo', { n: diffHours })
    return t('ago.daysAgo', { n: diffDays })
  }

  if (status === 'loading' || !session) {
    return <BrandPageLoading />
  }

  return (
    <div className="glass-page min-h-screen" style={{ backgroundColor: '#fcfcfd' }}>
      <Navbar />

      {/* 自定义呼吸动画 */}
      <style>{`
        @keyframes breathe-drift-1 {
          0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.5; }
          25% { transform: translate(30px, -20px) scale(1.15); opacity: 0.7; }
          50% { transform: translate(-20px, 15px) scale(0.95); opacity: 0.4; }
          75% { transform: translate(15px, 25px) scale(1.1); opacity: 0.65; }
        }
        @keyframes breathe-drift-2 {
          0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.45; }
          30% { transform: translate(-25px, 20px) scale(1.2); opacity: 0.7; }
          60% { transform: translate(20px, -15px) scale(0.9); opacity: 0.35; }
          80% { transform: translate(-10px, -25px) scale(1.05); opacity: 0.6; }
        }
        @keyframes breathe-drift-3 {
          0%, 100% { transform: translate(0, 0) scale(1.05); opacity: 0.4; }
          20% { transform: translate(20px, 15px) scale(0.9); opacity: 0.55; }
          45% { transform: translate(-15px, -20px) scale(1.15); opacity: 0.7; }
          70% { transform: translate(10px, -10px) scale(1); opacity: 0.35; }
        }
        @keyframes home-hero-focus-rack-text {
          0%, 70%, 100% { filter: blur(0px); opacity: 1; }
          75% { filter: blur(3px); opacity: 0.85; }
          80% { filter: blur(1.5px); opacity: 0.9; }
          85% { filter: blur(0.5px); opacity: 0.95; }
          88% { filter: blur(1px); opacity: 0.92; }
          92% { filter: blur(0px); opacity: 1; }
        }
        @keyframes home-hero-focus-rack-frame {
          0%, 70%, 100% {
            opacity: 0.24;
            filter: blur(0px);
            transform: scale(1);
            box-shadow: 0 0 0 rgba(255, 255, 255, 0);
          }
          75% {
            opacity: 0.7;
            filter: blur(2px);
            transform: scale(1.04);
            box-shadow: 0 0 14px rgba(255, 255, 255, 0.18);
          }
          80% {
            opacity: 0.58;
            filter: blur(1px);
            transform: scale(1.02);
            box-shadow: 0 0 10px rgba(255, 255, 255, 0.12);
          }
          85% {
            opacity: 0.5;
            filter: blur(0.5px);
            transform: scale(1.01);
            box-shadow: 0 0 6px rgba(255, 255, 255, 0.08);
          }
          88% {
            opacity: 0.56;
            filter: blur(0.75px);
            transform: scale(1.02);
            box-shadow: 0 0 8px rgba(255, 255, 255, 0.1);
          }
          92% {
            opacity: 0.24;
            filter: blur(0px);
            transform: scale(1);
            box-shadow: 0 0 0 rgba(255, 255, 255, 0);
          }
        }
        @keyframes home-hero-focus-rack-rec {
          0%, 70%, 100% {
            opacity: 0.58;
            filter: blur(0px);
            transform: scale(1);
          }
          75% {
            opacity: 1;
            filter: blur(1.5px);
            transform: scale(1.06);
          }
          80% {
            opacity: 0.9;
            filter: blur(0.8px);
            transform: scale(1.03);
          }
          85% {
            opacity: 0.78;
            filter: blur(0.35px);
            transform: scale(1.01);
          }
          88% {
            opacity: 0.86;
            filter: blur(0.6px);
            transform: scale(1.02);
          }
          92% {
            opacity: 0.58;
            filter: blur(0px);
            transform: scale(1);
          }
        }
      `}</style>

      <main className="flex flex-col items-center pt-[13vh] pb-12 px-4 max-w-5xl mx-auto w-full">

        {/* ─── 取景器整体包裹：标题 + 输入框 ─── */}
        <div className="w-full relative p-5 [--home-hero-focus-rack-duration:8s]">
          {/* 四角校准线 */}
          <span
            data-home-focus-corner="top-left"
            className="absolute top-0 left-0 w-5 h-5 border-t border-l border-[var(--glass-text-primary)] pointer-events-none z-10"
            style={{ animation: 'home-hero-focus-rack-frame var(--home-hero-focus-rack-duration) ease-in-out infinite' }}
          />
          <span
            data-home-focus-corner="top-right"
            className="absolute top-0 right-0 w-5 h-5 border-t border-r border-[var(--glass-text-primary)] pointer-events-none z-10"
            style={{ animation: 'home-hero-focus-rack-frame var(--home-hero-focus-rack-duration) ease-in-out infinite' }}
          />
          <span
            data-home-focus-corner="bottom-left"
            className="absolute bottom-0 left-0 w-5 h-5 border-b border-l border-[var(--glass-text-primary)] pointer-events-none z-10"
            style={{ animation: 'home-hero-focus-rack-frame var(--home-hero-focus-rack-duration) ease-in-out infinite' }}
          />
          <span
            data-home-focus-corner="bottom-right"
            className="absolute bottom-0 right-0 w-5 h-5 border-b border-r border-[var(--glass-text-primary)] pointer-events-none z-10"
            style={{ animation: 'home-hero-focus-rack-frame var(--home-hero-focus-rack-duration) ease-in-out infinite' }}
          />

          {/* REC 录制指示灯 */}
          <span
            data-home-focus-rec="true"
            className="absolute top-2 right-7 flex items-center gap-1 z-10"
            style={{ animation: 'home-hero-focus-rack-rec var(--home-hero-focus-rack-duration) ease-in-out infinite' }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.7)]" />
            <span className="text-[8px] font-mono font-bold tracking-widest text-red-500/70">REC</span>
          </span>

          {/* 标题区 */}
          <TypewriterHero
            title={t('title')}
            subtitle={t('subtitle')}
            focusAnimation="home-hero-focus-rack-text var(--home-hero-focus-rack-duration) ease-in-out infinite"
            subtitleAnimation="home-hero-focus-rack-text var(--home-hero-focus-rack-duration) ease-in-out infinite"
          />

          {/* 呼吸光晕 + 输入区域 */}
          <div className="w-full relative group">
            <div
              className="absolute -inset-10 rounded-[48px] pointer-events-none"
              style={{
                background: 'radial-gradient(ellipse 80% 60% at 30% 40%, rgba(47, 123, 255, 0.30), transparent 70%)',
                animation: 'breathe-drift-1 8s ease-in-out infinite',
                filter: 'blur(30px)',
              }}
            />
            <div
              className="absolute -inset-10 rounded-[48px] pointer-events-none"
              style={{
                background: 'radial-gradient(ellipse 70% 80% at 70% 60%, rgba(56, 189, 248, 0.24), transparent 70%)',
                animation: 'breathe-drift-2 10s ease-in-out infinite',
                filter: 'blur(35px)',
              }}
            />
            <div
              className="absolute -inset-12 rounded-[56px] pointer-events-none"
              style={{
                background: 'radial-gradient(ellipse 60% 50% at 50% 50%, rgba(244, 114, 182, 0.18), transparent 70%)',
                animation: 'breathe-drift-3 12s ease-in-out infinite',
                filter: 'blur(40px)',
              }}
            />

            <StoryInputComposer
              value={inputValue}
              onValueChange={(nextValue) => {
                setInputValue(nextValue)
                if (createError) {
                  setCreateError(null)
                }
              }}
              onSubmit={handleCreate}
              onPaste={handleComposerPaste}
              placeholder={t('inputPlaceholder')}
              minRows={HOME_QUICK_START_MIN_ROWS}
              containerClassName="relative mx-auto w-full max-w-[792px] rounded-[28px] border border-[rgba(15,17,23,0.08)] bg-white/85 shadow-[0_2px_4px_rgba(15,17,23,0.03),0_8px_20px_-6px_rgba(15,17,23,0.07),0_32px_64px_-20px_rgba(15,17,23,0.16)] backdrop-blur-[20px] transition-all duration-300 focus-within:border-[rgba(47,123,255,0.38)] focus-within:shadow-[0_2px_4px_rgba(15,17,23,0.04),0_12px_28px_-8px_rgba(47,123,255,0.20),0_40px_80px_-24px_rgba(15,17,23,0.20)]"
              textareaShellClassName=""
              textareaClassName="min-h-[112px] px-7 pb-3 pt-7 text-[17px] leading-7 align-top"
              controlsClassName="flex items-center px-4 pb-4"
              actionsClassName="flex w-full items-center justify-between"
              footerClassName="px-7 pb-5"
              primaryAction={(
                <button
                  type="button"
                  aria-label={t('startCreation')}
                  title={t('startCreation')}
                  onClick={() => void handleCreate()}
                  disabled={createDisabled}
                  className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full transition"
                  style={{
                    background: createDisabled
                      ? 'rgba(88,92,128,0.14)'
                      : 'linear-gradient(140deg, var(--glass-accent-from) 0%, var(--glass-accent-to) 100%)',
                    color: createDisabled ? 'rgba(88,92,128,0.72)' : '#fff',
                    boxShadow: createDisabled ? 'none' : '0 6px 16px -4px var(--glass-accent-shadow-strong)',
                  }}
                >
                  <AppIcon name="arrowRight" className={`h-[18px] w-[18px] ${createLoading ? 'animate-pulse' : ''}`} />
                </button>
              )}
              secondaryActions={(
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={ta('attachments.openUpload')}
                    title={ta('attachments.openUpload')}
                    disabled={createLoading || attachUploading || (
                      attachments.length >= PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_FILES
                      && pendingMediaFiles.length >= PROJECT_ASSISTANT_MEDIA_ATTACHMENT_MAX_FILES
                    )}
                    onClick={attachmentPicker.open}
                    className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-[rgba(15,17,23,0.55)] transition hover:bg-black/[0.05] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <AppIcon name="plus" className="h-[18px] w-[18px]" />
                  </button>
                </div>
              )}
              footer={attachments.length > 0 || pendingMediaFiles.length > 0 || attachUploading || attachError || createError ? (
                <div className="space-y-3">
                  <TextAttachmentChips attachments={attachments} onRemove={createLoading ? undefined : handleRemoveAttachment} />
                  <PendingMediaFileChips
                    files={pendingMediaFiles}
                    onRemove={createLoading ? undefined : handleRemovePendingMediaFile}
                  />
                  {attachUploading ? (
                    <div className="inline-flex items-center gap-2 rounded-lg border border-[var(--glass-stroke-base)] bg-white/90 px-2.5 py-1.5 text-xs leading-none text-[var(--glass-text-secondary)] shadow-sm">
                      <AppIcon name="loader" className="h-3.5 w-3.5 animate-spin text-[var(--glass-tone-info-fg)]" aria-hidden="true" />
                      {ta('attachments.mediaUploading')}
                    </div>
                  ) : null}
                  {attachError ? (
                    <p className="rounded-xl bg-[var(--glass-tone-surface)] px-4 py-3 text-sm text-[var(--glass-tone-danger-fg)] shadow-[var(--glass-tone-shadow)]">
                      {attachError}
                    </p>
                  ) : null}
                  {createError ? (
                    <p className="rounded-xl bg-[var(--glass-tone-surface)] px-4 py-3 text-sm text-[var(--glass-tone-danger-fg)] shadow-[var(--glass-tone-shadow)]">
                      {createError}
                    </p>
                  ) : null}
                </div>
              ) : null}
            />
          </div>
        </div>
      </main>

      {/* 最近项目 */}
      <section className="px-4 sm:px-6 lg:px-10 pb-8 max-w-[1400px] mx-auto w-full">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold text-[var(--glass-text-secondary)]">{t('recentProjects')}</h2>
          <Link
            href={{ pathname: '/workspace' }}
            className="text-xs text-[var(--glass-tone-info-fg)] hover:underline font-medium"
          >
            {t('viewAll')}
          </Link>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="glass-surface p-5 animate-pulse">
                <div className="h-4 bg-[var(--glass-bg-muted)] rounded mb-3" />
                <div className="h-3 bg-[var(--glass-bg-muted)] rounded mb-2" />
                <div className="h-3 bg-[var(--glass-bg-muted)] rounded w-2/3" />
              </div>
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-12 h-12 bg-[var(--glass-bg-muted)] rounded-xl flex items-center justify-center mx-auto mb-3">
              <AppIcon name="folderCards" className="w-6 h-6 text-[var(--glass-text-tertiary)]" />
            </div>
            <p className="text-sm text-[var(--glass-text-tertiary)]">{t('noProjects')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            {projects.map((project) => (
              <Link
                key={project.id}
                href={{ pathname: `/workspace/${project.id}` }}
                className="glass-surface cursor-pointer group hover:border-[var(--glass-tone-info-fg)]/40 transition-all duration-300 overflow-hidden relative block"
              >
                <div className="absolute inset-0 rounded-[inherit] bg-gradient-to-br from-blue-500/5 to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
                <div className="p-5 relative z-10">
                  <h3 className="text-sm font-bold text-[var(--glass-text-primary)] mb-2 group-hover:text-[var(--glass-tone-info-fg)] transition-colors line-clamp-1">
                    {project.name}
                  </h3>
                  {project.description && (
                    <div className="flex items-start gap-2 mb-3">
                      <AppIcon name="fileText" className="w-3.5 h-3.5 text-[var(--glass-text-tertiary)] mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-[var(--glass-text-secondary)] line-clamp-2 leading-relaxed">
                        {project.description}
                      </p>
                    </div>
                  )}
                  {project.stats && project.stats.resources > 0 && (
                    <div className="flex items-center gap-2 mb-3">
                      <IconGradientDefs className="w-0 h-0 absolute" aria-hidden="true" />
                      <AppIcon name="statsBarGradient" className="w-4 h-4 flex-shrink-0" />
                      <div className="flex items-center gap-3 text-sm font-semibold bg-gradient-to-r from-blue-500 to-cyan-500 bg-clip-text text-transparent">
                        <span className="flex items-center gap-1">
                          <AppIcon name="folder" className="w-3.5 h-3.5 text-[var(--glass-tone-info-fg)]" />
                          {project.stats.folders}
                        </span>
                        <span className="flex items-center gap-1">
                          <AppIcon name="statsImageGradient" className="w-3.5 h-3.5" />
                          {project.stats.images}
                        </span>
                        <span className="flex items-center gap-1">
                          <AppIcon name="statsVideoGradient" className="w-3.5 h-3.5" />
                          {project.stats.videos}
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-1 text-[10px] text-[var(--glass-text-tertiary)]">
                    <AppIcon name="clock" className="w-3 h-3" />
                    {formatTimeAgo(project.updatedAt)}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
      {attachmentPicker.input}
    </div>
  )
}
