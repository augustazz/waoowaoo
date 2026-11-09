/**
 * React Query Hooks 统一导出
 * 
 * 使用示例：
 * import { useWorkspaceResources } from '@/lib/query/hooks'
 */

// 中心资产库
export {
    useAssets,
    useAssetActions,
    useRefreshAssets,
} from './useAssets'

export {
    useGlobalCharacters,
    useGlobalLocations,
    useGlobalProps,
    useGlobalFolders,
    useCreateFolder,
    useUpdateFolder,
    useDeleteFolder,
    useRefreshGlobalAssets,
    type GlobalCharacter,
    type GlobalCharacterAppearance,
    type GlobalLocation,
    type GlobalLocationImage,
    type GlobalProp,
    type GlobalFolder,
} from './useGlobalAssets'
export {
    useSelectCharacterImage,
    useUndoCharacterImage,
    useUploadCharacterImage,
    useDeleteCharacter,
    useDeleteCharacterAppearance,
    useSelectLocationImage,
    useUndoLocationImage,
    useUploadLocationImage,
    useDeleteLocation,
    useUpdateCharacterName,
    useUpdateLocationName,
    useUpdateCharacterAppearanceDescription,
    useUpdateLocationSummary,
    useCreateAssetHubLocation,
    useUploadAssetHubTempMedia,
    useCreateAssetHubCharacter,
} from '../mutations/useAssetHubMutations'

// 实时任务
export {
    useSSE,
} from './useSSE'

export {
    useAssetTaskPresentation,
    useVideoTaskPresentation,
    type TaskPresentationTarget,
} from './useTaskPresentation'

// 项目数据
export {
    useProjectData,
    useRefreshProjectData,
} from './useProjectData'

export {
    useWorkspaceResources,
} from './useWorkspaceResources'

export {
    useWorkspaceResourceView,
} from './useWorkspaceResourceView'

export {
    useWorkspaceResourceByPath,
} from './useWorkspaceResourceByPath'

export {
    useProductionOverview,
} from './useProductionOverview'

export {
    useProductionStepContent,
} from './useProductionStepContent'

export {
    useWorkspaceResourceVersions,
    useWorkspaceResourceVersion,
} from './useWorkspaceResourceVersions'

export {
    useAgentSessionView,
} from './useAgentSessionView'


export {
    useUserModels,
    type UserModelOption as QueryUserModelOption,
    type UserModelsPayload as QueryUserModelsPayload,
} from './useUserModels'
export { useCanvasGenerationCapabilities } from './useCanvasGenerationCapabilities'
