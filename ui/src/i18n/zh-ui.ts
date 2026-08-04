/**
 * Chinese UI compatibility layer.
 *
 * Paperclip is progressively moving hard-coded UI copy into i18next. Until
 * every surface is keyed, this small DOM pass keeps the shipped application
 * understandable in Simplified Chinese without translating user data,
 * markdown, code, paths, or agent output.
 */

const EXACT_TRANSLATIONS: Record<string, string> = {
  // App shell and navigation
  Paperclip: "Paperclip",
  "Create your first company": "创建您的第一家公司",
  "Get started by creating a company.": "通过创建公司开始。",
  "New Company": "新公司",
  "New Task": "新任务",
  "Select company": "选择公司",
  Companies: "公司",
  Company: "公司",
  "Company Settings": "公司设置",
  Dashboard: "仪表盘",
  Inbox: "收件箱",
  Work: "工作",
  Cases: "案例",
  Routines: "例行任务",
  Pipelines: "流水线",
  Goals: "目标",
  Artifacts: "产物",
  Skills: "技能",
  Workspaces: "工作区",
  Projects: "项目",
  Agents: "智能体",
  Agent: "智能体",
  Tasks: "任务",
  Issues: "问题",
  Search: "搜索",
  Approvals: "审批",
  "Review Queue": "审核队列",
  Learnings: "经验总结",
  "Board Chat": "看板聊天",
  Org: "组织",
  Organization: "组织",
  Timeline: "时间线",
  Costs: "成本",
  Activity: "活动",
  Settings: "设置",
  General: "常规",
  Access: "访问权限",
  Users: "用户",
  Members: "成员",
  Billing: "计费",
  Appearance: "外观",
  Notifications: "通知",
  Security: "安全",
  Integrations: "集成",
  Plugins: "插件",
  Adapters: "适配器",
  Environments: "环境",
  "Instance settings": "实例设置",
  "Company settings": "公司设置",
  "Agent settings": "智能体设置",
  "Project settings": "项目设置",
  "Workspace settings": "工作区设置",

  // Common actions
  Create: "创建",
  "Create company": "创建公司",
  "Create project": "创建项目",
  "Create issue": "创建问题",
  "New issue": "新问题",
  "New project": "新项目",
  Save: "保存",
  "Save changes": "保存更改",
  "Save environment": "保存环境",
  Cancel: "取消",
  Close: "关闭",
  Delete: "删除",
  "Delete company": "删除公司",
  Remove: "移除",
  "Remove member": "移除成员",
  Edit: "编辑",
  Rename: "重命名",
  Archive: "归档",
  Restore: "恢复",
  Open: "打开",
  Back: "返回",
  Next: "下一步",
  Previous: "上一步",
  Continue: "继续",
  Submit: "提交",
  Confirm: "确认",
  Retry: "重试",
  Refresh: "刷新",
  Copy: "复制",
  Copied: "已复制",
  "Copy failed": "复制失败",
  "Copy message": "复制消息",
  Dismiss: "忽略",
  Approve: "批准",
  Reject: "拒绝",
  Run: "运行",
  Stop: "停止",
  Pause: "暂停",
  Resume: "恢复运行",
  Restart: "重启",
  Install: "安装",
  Reinstall: "重新安装",
  Uninstall: "卸载",
  Add: "添加",
  "Add member": "添加成员",
  Invite: "邀请",
  Import: "导入",
  Export: "导出",
  Download: "下载",
  Upload: "上传",
  View: "查看",
  "View all": "查看全部",
  "See all": "查看全部",
  "Show more": "显示更多",
  "Show less": "显示更少",
  Clear: "清除",
  Reset: "重置",
  Apply: "应用",
  "Apply filters": "应用筛选",
  Filter: "筛选",
  Sort: "排序",
  Group: "分组",
  Move: "移动",
  Assign: "分配",
  Unassign: "取消分配",
  "Mark as done": "标记为完成",
  "Mark as read": "标记为已读",
  "Open in new tab": "在新标签页打开",
  "Copy link": "复制链接",
  "Open link": "打开链接",

  // Status and workflow
  Active: "活跃",
  Inactive: "未启用",
  Paused: "已暂停",
  Archived: "已归档",
  Pending: "待处理",
  "In Progress": "进行中",
  Blocked: "已阻塞",
  Done: "已完成",
  Todo: "待办",
  Failed: "失败",
  Completed: "已完成",
  Cancelled: "已取消",
  Canceled: "已取消",
  Running: "运行中",
  Queued: "排队中",
  Ready: "就绪",
  Idle: "空闲",
  Connected: "已连接",
  Disconnected: "未连接",
  Enabled: "已启用",
  Disabled: "已禁用",
  Unknown: "未知",
  Success: "成功",
  Error: "错误",
  Warning: "警告",
  Draft: "草稿",
  Opened: "已打开",
  Closed: "已关闭",
  Approved: "已批准",
  Rejected: "已拒绝",
  Expired: "已过期",
  Loading: "加载中",
  "Loading…": "加载中…",
  "Loading...": "加载中…",
  "No results": "没有结果",
  "No results found": "没有找到结果",
  "No items": "暂无项目",
  "No projects": "暂无项目",
  "No tasks": "暂无任务",
  "No issues": "暂无问题",
  "No agents": "暂无智能体",
  "No workspaces": "暂无工作区",
  "No activity": "暂无活动",
  "No companies": "暂无公司",
  "Not configured": "尚未配置",
  "Not found": "未找到",
  Required: "必填",
  Optional: "可选",
  "Try again": "再试一次",
  "Something went wrong": "出了点问题",
  "An error occurred": "发生错误",
  "Unknown error": "未知错误",
  "Access denied": "访问被拒绝",
  Unauthorized: "未授权",
  Forbidden: "禁止访问",

  // Data labels and detail panes
  Name: "名称",
  Title: "标题",
  Description: "描述",
  Status: "状态",
  Priority: "优先级",
  Assignee: "负责人",
  Owner: "所有者",
  Responsible: "负责人",
  Created: "创建时间",
  Updated: "更新时间",
  "Created at": "创建时间",
  "Updated at": "更新时间",
  "Due date": "截止日期",
  "Start date": "开始日期",
  "End date": "结束日期",
  Type: "类型",
  Kind: "类别",
  Mode: "模式",
  Provider: "提供商",
  Model: "模型",
  Version: "版本",
  Details: "详情",
  Overview: "概览",
  Configuration: "配置",
  Instructions: "说明",
  Prompt: "提示词",
  Comments: "评论",
  History: "历史记录",
  Budget: "预算",
  Cost: "成本",
  Usage: "用量",
  Time: "时间",
  Date: "日期",
  Files: "文件",
  Actions: "操作",
  Logs: "日志",
  Output: "输出",
  Input: "输入",
  Result: "结果",
  Message: "消息",
  Reason: "原因",
  Notes: "备注",
  Tags: "标签",
  Team: "团队",
  Workspace: "工作区",
  Project: "项目",
  Issue: "问题",
  Case: "案例",
  Routine: "例行任务",
  Pipeline: "流水线",
  Trigger: "触发器",
  Schedule: "计划",
  Heartbeat: "心跳",
  Secrets: "密钥",
  Identity: "身份",
  "No project": "无项目",
  Unassigned: "未分配",
  "No assignee": "无负责人",
  "No description": "暂无描述",
  "No title": "无标题",
  "No data available": "暂无数据",
  "No comments yet": "暂无评论",

  // Forms and setup
  "Select an option": "选择一个选项",
  "Select an agent": "选择智能体",
  "Select a project": "选择项目",
  "Select a workspace": "选择工作区",
  "Select a company": "选择公司",
  "Search...": "搜索…",
  "Search issues...": "搜索问题…",
  "Search projects...": "搜索项目…",
  "Search agents...": "搜索智能体…",
  "Enter a name": "输入名称",
  "Enter a description": "输入描述",
  "Version (optional)": "版本（可选）",
  "Path to adapter package": "适配器包路径",
  "Package Name": "包名称",
  Package: "包",
  Current: "当前版本",
  "Latest on npm": "npm 上的最新版本",
  "Install External Adapter": "安装外部适配器",
  "Reinstall Adapter": "重新安装适配器",
  "Remove Adapter": "移除适配器",
  "External Adapters": "外部适配器",
  "Built-in Adapters": "内置适配器",
  "No external adapters installed": "未安装外部适配器",
  "No built-in adapters found.": "未找到内置适配器。",
  "External adapters are alpha.": "外部适配器目前处于 Alpha 阶段。",
  "Add an adapter from npm or a local path.": "从 npm 或本地路径添加适配器。",
  "Save successfully": "保存成功",
  "Saved successfully": "保存成功",
  "Changes saved": "更改已保存",
  "Saving…": "保存中…",
  "Are you sure?": "确定要继续吗？",
  "This action cannot be undone.": "此操作无法撤销。",
  "Delete permanently": "永久删除",
  "Cancel and close": "取消并关闭",

  "Skip to Main Content": "跳转到主内容",
  "Agents Enabled": "已启用智能体",
  "Tasks In Progress": "进行中的任务",
  "Pending Approvals": "待处理审批",
  "Open budgets": "查看预算",
  "No tasks yet.": "暂无任务。",
  "Run Activity": "运行活动",
  "Tasks by Priority": "任务按优先级",
  "Tasks by Status": "任务按状态",
  "Command Palette": "命令面板",
  "Live now": "正在运行",
  Started: "已开始",
  "Run failed": "运行失败",
  "Built-in": "内置",
  // Dashboard and runtime copy
  "View all agents": "查看全部智能体",
  Finished: "已完成",
  "Month Spend": "本月支出",
  "Unlimited budget": "不限预算",
  "Awaiting board review": "等待董事会审核",
  "Running activity": "运行中活动",
  "Task by priority": "任务按优先级",
  "Tasks by priority": "任务按优先级",
  "Task by status": "任务按状态",
  "Tasks by status": "任务按状态",
  "Last 14 days": "最近 14 天",
  Succeeded: "成功",
  Failure: "失败",
  Other: "其他",
  "Success Rate": "成功率",
  "Recent Activity": "最近活动",
  "Recent Tasks": "最近任务",
  "Search for a command to run...": "搜索要运行的命令…",
  "just now": "刚刚",
  "System built-in agent": "系统内置智能体",
  "Environment lease released": "环境租约已释放",
  "Environment lease acquired": "环境租约已获取",

  // Common explanatory text
  "Create a company to get started": "创建公司以开始使用",
  "Create your first project": "创建您的第一个项目",
  "Create your first agent": "创建您的第一个智能体",
  "There is nothing here yet.": "这里暂时还没有内容。",
  "No activity yet.": "暂时还没有活动。",
  "No results yet.": "暂时还没有结果。",
  "Loading companies...": "正在加载公司…",
  "Loading agents...": "正在加载智能体…",
  "Loading projects...": "正在加载项目…",
  "Loading issues...": "正在加载问题…",
  "Loading workspaces...": "正在加载工作区…",
  "Loading adapters...": "正在加载适配器…",
  "Loading settings...": "正在加载设置…",
  "Failed to load": "加载失败",
  "Failed to save": "保存失败",
  "Failed to delete": "删除失败",
  "Failed to update": "更新失败",
  "Unknown error occurred": "发生未知错误",
  "Try again later": "请稍后再试",
  "Changes will take effect after restart.": "更改将在重启后生效。",

  // Shortcuts and accessibility
  "Keyboard shortcuts": "键盘快捷键",
  "Press Esc to close": "按 Esc 关闭",
  "Press Enter to select": "按 Enter 选择",
  "Open command palette": "打开命令面板",
  "Collapse sidebar": "收起侧边栏",
  "Expand sidebar": "展开侧边栏",
  "Toggle sidebar": "切换侧边栏",
  "New item": "新建项目",
};

const TOKEN_TRANSLATIONS: Record<string, string> = {
  dashboard: "仪表盘",
  inbox: "收件箱",
  work: "工作",
  company: "公司",
  companies: "公司",
  org: "组织",
  organization: "组织",
  agent: "智能体",
  agents: "智能体",
  task: "任务",
  tasks: "任务",
  issue: "问题",
  issues: "问题",
  project: "项目",
  projects: "项目",
  workspace: "工作区",
  workspaces: "工作区",
  routine: "例行任务",
  routines: "例行任务",
  pipeline: "流水线",
  pipelines: "流水线",
  goal: "目标",
  goals: "目标",
  artifact: "产物",
  artifacts: "产物",
  skill: "技能",
  skills: "技能",
  approval: "审批",
  approvals: "审批",
  activity: "活动",
  activities: "活动",
  settings: "设置",
  search: "搜索",
  status: "状态",
  priority: "优先级",
  assignee: "负责人",
  owner: "所有者",
  description: "描述",
  configuration: "配置",
  overview: "概览",
  details: "详情",
  history: "历史",
  name: "名称",
  title: "标题",
  type: "类型",
  model: "模型",
  provider: "提供商",
  version: "版本",
  current: "当前",
  latest: "最新",
  active: "活跃",
  inactive: "未启用",
  paused: "已暂停",
  archived: "已归档",
  pending: "待处理",
  blocked: "已阻塞",
  completed: "已完成",
  complete: "完成",
  cancelled: "已取消",
  canceled: "已取消",
  failed: "失败",
  running: "运行中",
  queued: "排队中",
  ready: "就绪",
  idle: "空闲",
  enabled: "已启用",
  disabled: "已禁用",
  unknown: "未知",
  error: "错误",
  warning: "警告",
  success: "成功",
  loading: "加载中",
  create: "创建",
  save: "保存",
  cancel: "取消",
  close: "关闭",
  delete: "删除",
  remove: "移除",
  edit: "编辑",
  rename: "重命名",
  archive: "归档",
  restore: "恢复",
  open: "打开",
  back: "返回",
  next: "下一步",
  previous: "上一步",
  continue: "继续",
  retry: "重试",
  refresh: "刷新",
  copy: "复制",
  copied: "已复制",
  dismiss: "忽略",
  approve: "批准",
  reject: "拒绝",
  run: "运行",
  stop: "停止",
  pause: "暂停",
  resume: "恢复运行",
  restart: "重启",
  install: "安装",
  reinstall: "重新安装",
  add: "添加",
  filter: "筛选",
  sort: "排序",
  group: "分组",
  clear: "清除",
  reset: "重置",
  apply: "应用",
  optional: "可选",
  required: "必填",
  default: "默认",
  none: "无",
  all: "全部",
  files: "文件",
  file: "文件",
  logs: "日志",
  output: "输出",
  input: "输入",
  result: "结果",
  message: "消息",
  reason: "原因",
  comments: "评论",
  members: "成员",
  environment: "环境",
  environments: "环境",
  adapter: "适配器",
  adapters: "适配器",
  plugin: "插件",
  plugins: "插件",
  secrets: "密钥",
  cost: "成本",
  costs: "成本",
  budget: "预算",
  usage: "用量",
  date: "日期",
  time: "时间",
  created: "已创建",
  updated: "已更新",
  finished: "已完成",
  after: "后",
  second: "秒",
  seconds: "秒",
  minute: "分钟",
  minutes: "分钟",
  hour: "小时",
  hours: "小时",
  day: "天",
  days: "天",
  week: "周",
  weeks: "周",
  ago: "前",
  month: "月",
  spend: "支出",
  unlimited: "不限",
  awaiting: "等待",
  review: "审核",
  last: "最近",
  succeeded: "成功",
  failure: "失败",
  other: "其他",
  rate: "率",
  recent: "最近",
  built: "内置",
  provisioned: "已配置",
  lease: "租约",
  released: "已释放",
  acquired: "已获取",
  command: "命令",
  by: "按",
  errors: "错误",
  system: "系统",
  reconciled: "已同步",
  palette: "面板",
  live: "实时",
  started: "已开始",
  overrides: "覆盖项",
  incident: "事件",
  incidents: "事件",
  connected: "已连接",
  disconnected: "未连接",
};

const ENTITY_TRANSLATIONS: Record<string, string> = {
  adapters: "适配器",
  agents: "智能体",
  companies: "公司",
  projects: "项目",
  issues: "问题",
  tasks: "任务",
  workspaces: "工作区",
  routines: "例行任务",
  pipelines: "流水线",
  results: "结果",
  items: "项目",
  members: "成员",
  settings: "设置",
  data: "数据",
};

const PHRASES_BY_LENGTH = Object.keys(EXACT_TRANSLATIONS).sort((a, b) => b.length - a.length);
const TOKEN_PATTERN = /\b[A-Za-z][A-Za-z0-9'-]*\b/g;
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "PRE", "CODE", "TEXTAREA", "SVG"]);
const TRANSLATABLE_ATTRIBUTES = ["aria-label", "title", "placeholder", "alt"] as const;

function preserveWhitespace(original: string, translated: string): string {
  const leading = original.match(/^\s*/u)?.[0] ?? "";
  const trailing = original.match(/\s*$/u)?.[0] ?? "";
  return `${leading}${translated}${trailing}`;
}

function translateEntity(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[.!?…]+$/u, "");
  if (ENTITY_TRANSLATIONS[normalized]) return ENTITY_TRANSLATIONS[normalized];
  return normalized.replace(TOKEN_PATTERN, (token) => TOKEN_TRANSLATIONS[token.toLowerCase()] ?? token);
}

function formatRelativeTime(amount: string, unit: string): string {
  const units: Record<string, string> = { s: "秒", m: "分钟", h: "小时", d: "天", w: "周" };
  return `${amount}${units[unit.toLowerCase()] ?? unit}前`;
}

function translateDynamicPhrase(value: string): string | null {
  let match = value.match(/^Finished\s+(\d+)([smhdw])\s+ago$/iu);
  if (match) return `已完成 ${formatRelativeTime(match[1], match[2])}`;

  match = value.match(/^(\d+)([smhdw])\s+ago$/iu);
  if (match) return formatRelativeTime(match[1], match[2]);

  match = value.match(/^(\d+)\s+errors?$/iu);
  if (match) return `${match[1]} 个错误`;

  match = value.match(/^(\d+)\s+pending\s+approvals?$/iu);
  if (match) return `${match[1]} 个待处理审批`;

  match = value.match(/^(\d+)\s+running,\s*(\d+)\s+paused,\s*(\d+)\s+errors?$/iu);
  if (match) return `${match[1]} 个运行中，${match[2]} 个已暂停，${match[3]} 个错误`;

  match = value.match(/^(\d+)\s+open,\s*(\d+)\s+blocked$/iu);
  if (match) return `${match[1]} 个打开，${match[2]} 个已阻塞`;

  match = value.match(/^(\d+)\s+active\s+budget\s+incidents?$/iu);
  if (match) return `${match[1]} 个活跃预算事件`;

  match = value.match(/^(\d+)\s+agents\s+paused\s+·\s+(\d+)\s+projects\s+paused\s+·\s+(\d+)\s+pending\s+budget\s+approvals$/iu);
  if (match) return `${match[1]} 个智能体已暂停 · ${match[2]} 个项目已暂停 · ${match[3]} 个待处理预算审批`;

  match = value.match(/^(\d+)%\s+of\s+(.+)\s+budget$/iu);
  if (match) return `${match[1]}% / ${match[2]} 预算`;

  match = value.match(/^(\d+)\s+budget\s+overrides\s+awaiting\s+board\s+review$/iu);
  if (match) return `${match[1]} 个预算覆盖项等待董事会审核`;

  match = value.match(/^System\s+built\s+in\s+agent\s+(.+?)\s+reconciled$/iu);
  if (match) return `系统内置智能体 ${match[1]} 已同步`;

  match = value.match(/^System\s+built\s+in\s+agent\s+(.+?)\s+provisioned\s+(.+)$/iu);
  if (match) return `系统内置智能体已配置 ${match[2]}`;

  match = value.match(/^Started\s+(.+)$/iu);
  if (match) return `已开始 ${match[1]}`;

  match = value.match(/^Loading\s+(.+?)(?:\.{3}|…)?$/iu);
  if (match) return `正在加载${translateEntity(match[1])}…`;

  match = value.match(/^No\s+(.+?)[.!]?$/iu);
  if (match) return `暂无${translateEntity(match[1])}`;

  match = value.match(/^(\d+)\s+selected$/iu);
  if (match) return `已选择 ${match[1]} 项`;

  match = value.match(/^Showing\s+(\d+)\s+of\s+(\d+)$/iu);
  if (match) return `显示 ${match[1]} / ${match[2]}`;

  match = value.match(/^Page\s+(\d+)$/iu);
  if (match) return `第 ${match[1]} 页`;

  match = value.match(/^(\d+)\s+items?$/iu);
  if (match) return `${match[1]} 个项目`;

  match = value.match(/^Last updated\s+(.+)$/iu);
  if (match) return `最后更新：${match[1]}`;

  return null;
}

/** Translate one UI string while preserving whitespace around it. */
export function translateChineseText(value: string): string {
  if (!value || !/[A-Za-z]/u.test(value)) return value;
  const core = value.trim();
  if (!core || core.length > 180 || /(?:https?:\/\/|[\\/]{2}|^#)/u.test(core)) return value;

  const exact = EXACT_TRANSLATIONS[core];
  if (exact) return preserveWhitespace(value, exact);

  const dynamic = translateDynamicPhrase(core);
  if (dynamic) return preserveWhitespace(value, dynamic);

  let translated = core;
  for (const phrase of PHRASES_BY_LENGTH) {
    if (phrase.length < 3 || !translated.includes(phrase)) continue;
    translated = translated.split(phrase).join(EXACT_TRANSLATIONS[phrase]);
  }

  // Only token-translate short, label-like strings. Long prose and user data
  // are intentionally left untouched.
  if (translated.length <= 96 && !/[{}<>`]/u.test(translated)) {
    translated = translated.replace(TOKEN_PATTERN, (token) => TOKEN_TRANSLATIONS[token.toLowerCase()] ?? token);
  }

  return translated === core ? value : preserveWhitespace(value, translated);
}

function shouldSkipElement(element: Element | null): boolean {
  if (!element) return true;
  if (SKIP_TAGS.has(element.tagName)) return true;
  if (element.closest("[data-zh-skip], [contenteditable='true'], [role='code']")) return true;
  return false;
}

function translateAttributes(root: Element): void {
  const elements = [root, ...Array.from(root.querySelectorAll("*"))];
  for (const element of elements) {
    if (shouldSkipElement(element)) continue;
    for (const attribute of TRANSLATABLE_ATTRIBUTES) {
      const value = element.getAttribute(attribute);
      if (!value) continue;
      const translated = translateChineseText(value);
      if (translated !== value) element.setAttribute(attribute, translated);
    }
  }
}

function translateTextNodes(root: Element): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let current: Node | null = walker.nextNode();
  while (current) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }
  for (const node of nodes) {
    if (shouldSkipElement(node.parentElement)) continue;
    const translated = translateChineseText(node.nodeValue ?? "");
    if (translated !== node.nodeValue) node.nodeValue = translated;
  }
}

/** Install a lightweight translator for the still-hard-coded Paperclip UI. */
export function installChineseUi(): () => void {
  if (typeof window === "undefined" || typeof document === "undefined" || !document.body) return () => {};

  document.documentElement.lang = "zh-CN";
  document.documentElement.dataset.paperclipLocale = "zh-CN";

  // React writes document.title directly on route changes. Wrap the browser
  // setter so titles such as "Dashboard • Company • Paperclip" stay localized
  // while company names remain untouched.
  const titlePrototype = Object.getOwnPropertyDescriptor(Document.prototype, "title");
  const titleOwnProperty = Object.getOwnPropertyDescriptor(document, "title");
  if (titlePrototype?.get && titlePrototype.set) {
    Object.defineProperty(document, "title", {
      configurable: true,
      enumerable: true,
      get: () => titlePrototype.get!.call(document),
      set: (value: string) => titlePrototype.set!.call(document, translateChineseText(value)),
    });
  }
  document.title = "Paperclip · 中文界面";

  let scheduled = false;
  let disposed = false;
  const translate = () => {
    if (disposed || !document.body) return;
    scheduled = false;
    translateAttributes(document.body);
    translateTextNodes(document.body);
  };
  const schedule = () => {
    if (scheduled || disposed) return;
    scheduled = true;
    queueMicrotask(translate);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, characterData: true, subtree: true });
  schedule();

  return () => {
    disposed = true;
    observer.disconnect();
    if (titleOwnProperty) {
      Object.defineProperty(document, "title", titleOwnProperty);
    } else {
      delete (document as unknown as { title?: string }).title;
    }
  };
}
