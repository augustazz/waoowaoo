import type { ProjectAgentLocale } from './locale'

type ProjectAgentOperationTitleCopy = {
  zh: string
  en: string
}

const PROJECT_AGENT_OPERATION_TITLE_COPY: Record<string, ProjectAgentOperationTitleCopy> = {
  register_uploaded_media: { zh: '保存上传素材', en: 'Save uploaded media' },
  save_project_document: { zh: '保存项目文档', en: 'Save project document' },
  revise_project_document: { zh: '修订项目文档', en: 'Revise project document' },
  create_folder: { zh: '创建文件夹', en: 'Create folder' },
  create_image: { zh: '生成图片资源', en: 'Generate image resource' },
  create_audio: { zh: '生成音频资源', en: 'Generate audio resource' },
  create_video: { zh: '生成视频资源', en: 'Generate video resource' },
  merge_videos: { zh: '合并视频资源', en: 'Merge video resources' },
  rerun_failed_production_items: { zh: '重试失败资源', en: 'Retry failed resources' },
  move_resource: { zh: '移动项目资源', en: 'Move project resource' },
  delete_resource: { zh: '删除项目资源', en: 'Delete project resource' },
  restore_resource: { zh: '恢复项目资源', en: 'Restore project resource' },
  generate_voice: { zh: '设计角色音色', en: 'Design voice' },
  bind_voice: { zh: '绑定角色音色', en: 'Bind voice' },
  web_search: { zh: '联网检索', en: 'Web research' },
  list_projects: { zh: '查看项目', en: 'List projects' },
  create_project: { zh: '创建项目', en: 'Create project' },
  get_project_basic: { zh: '读取项目基本信息', en: 'Read project basics' },
  update_project: { zh: '更新项目', en: 'Update project' },
  get_project_config: { zh: '读取项目配置', en: 'Read project configuration' },
  update_project_config: { zh: '设置项目配置', en: 'Set project configuration' },
  resolve_video_proxy: { zh: '解析视频地址', en: 'Resolve video address' },
  list_download_videos: { zh: '准备视频下载', en: 'Prepare video downloads' },
  get_user_preference: { zh: '读取用户偏好', en: 'Read user preference' },
  update_user_preference: { zh: '更新用户偏好', en: 'Update user preference' },
  list_user_models: { zh: '查看可用模型', en: 'List available models' },
  list_user_transactions: { zh: '查看交易记录', en: 'List transactions' },
  delete_asset: { zh: '删除资产', en: 'Delete asset' },
  generate_character_image: { zh: '生成角色图片', en: 'Generate character image' },
  generate_location_image: { zh: '生成场景图片', en: 'Generate location image' },
  asset_hub_list_folders: { zh: '查看资产文件夹', en: 'List asset folders' },
  asset_hub_picker: { zh: '查看全局资产', en: 'Browse global assets' },
  asset_hub_list_characters: { zh: '查看全局角色', en: 'List global characters' },
  asset_hub_get_character: { zh: '读取全局角色', en: 'Read global character' },
  asset_hub_list_locations: { zh: '查看全局场景', en: 'List global locations' },
  asset_hub_get_location: { zh: '读取全局场景', en: 'Read global location' },
}

export function localizeProjectAgentOperationTitle(
  operationId: string,
  locale: ProjectAgentLocale,
): string {
  return PROJECT_AGENT_OPERATION_TITLE_COPY[operationId]?.[locale]
    ?? (locale === 'en' ? 'Project operation' : '项目操作')
}
