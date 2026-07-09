# SciForge 科研任务场景候选

本文档记录 SciForge 对外呈现时最值得优先打磨的 10 个主科研任务场景，以及 3 个适合验证 Computer Use 的科研 GUI 场景。筛选标准是：

- 有明确输入、过程和最终产物，能被拍成 demo。
- 能体现 SciForge 的本地工作台、真实执行、证据链、artifact、Research Memory 或多 runtime harness。
- 尽量避免只像“写作包装”“项目管理”或“聊天问答”的虚场景。
- 每个场景代表一种不同购买理由，减少互相重叠。

## 最终推荐表

| 排名 | 任务场景 | 典型输入 | 最终展示物 | 主要卖点 |
| ---: | --- | --- | --- | --- |
| 1 | 连续科研冲刺：从研究问题到论文草稿包 | 研究问题、种子论文、公开数据集或代码库 | manuscript package、实验日志、图表、Evidence DAG、Research Memory | 最强 flagship，完整证明 SciForge 能做长周期科研推进 |
| 2 | 论文复现与 Benchmark 冲刺 | 论文 PDF、官方 repo、baseline 目标、失败日志 | 复现报告、运行日志、修复 diff、benchmark 表 | 证明 SciForge 能进入真实项目执行和验证 |
| 3 | 从实验数据到论文图与汇报材料 | CSV/JSON 数据、参考论文图或 PDF crop | publication figure、style review、Canvas 批注、PPT slide | 视觉冲击强，科研产物最直观 |
| 4 | 持续文献雷达与综述矩阵 | 课题关键词、排除词、arXiv/bioRxiv/Semantic Scholar profile | 每日 digest、Living Review Matrix、趋势摘要 | 高频刚需，适合 PI 和博士生日常使用 |
| 5 | Reviewer / Rebuttal Mode：审稿与回复冲刺 | 论文草稿、reviewer comments、实验结果和图表 | response letter、claim-evidence 表、补实验计划 | 痛点尖锐，体现证据约束和可信写作 |
| 6 | 数据集体检与可信分析报告 | 公开数据集、标注文件、数据处理脚本 | 数据质量报告、异常图、泄漏风险、分析 notebook | 落地稳定，适合 AI/ML 和企业研发 |
| 7 | 自动化实验巡检与异常追踪 | 训练/仿真/数据处理任务、日志目录、指标文件 | 实验状态日报、失败日志摘要、异常趋势、修复建议 | 展示 Workflow、Schedule、Code 和长期运行价值 |
| 8 | 导师-博士生周循环 | 本周线程、实验记录、图表、TODO、阻塞问题 | weekly status、blocker、decision record、下周计划 | 保留一个真实科研合作场景，贴近实验室工作方式 |
| 9 | 科学对象解析与文献交叉验证 | FASTA、PDB/mmCIF、SMILES/SDF/MOL、单细胞表达或 marker list | modality evidence、相关论文、实验建议 | 证明 SciForge 面向科学对象，不只是 PDF/文本 |
| 10 | 从论文 Methods 到可执行实验协议 | 论文 Methods、补充材料、实验约束、已有设备/数据 | SOP、变量/control 表、材料清单、风险检查表、分析计划 | 把论文方法从“读懂”推进到“可执行”，适合湿实验和计算实验 |
| 11 | ImageJ / Fiji 显微图像定量 | 显微图像、ROI/阈值规则、目标计数或强度指标 | 标注图、measurements.csv、定量摘要 | Computer Use 价值明显，能接入真实科研 GUI 工具 |
| 12 | GraphPad Prism / Origin 出图与统计 | 实验数据表、分组信息、统计检验要求 | 统计结果、论文图、导出 PNG/PDF | 很多实验室真实使用，适合验证 GUI 出图和统计流程 |
| 13 | PyMOL / ChimeraX 结构可视化 | PDB/mmCIF、突变位点、配体/口袋/结构域说明 | 结构截图、视角配置、图注草稿 | 连接科学对象解析和论文图产出，适合 Computer Use 展示 |

## 场景详述

### 1. 连续科研冲刺：从研究问题到论文草稿包

这个场景适合作为首页和路演的主 flagship。用户给出一个研究问题、几篇种子论文、一个公开数据集或代码库，SciForge 连续推进多天：

```text
Day 1: Paper Radar / Research Search 找领域现状
Day 2: 生成 Living Review Matrix 和研究 gap
Day 3: 提出可检验假设与实验计划
Day 4: 跑 baseline、数据分析或复现实验
Day 5: 生成图表、实验卡和证据链
Day 6: 写 Introduction / Related Work / Methods / Results 草稿
Day 7: Reviewer Mode 自查并导出 manuscript package
```

重点展示：不是“自动发表论文”，而是产出一份可审查、可修改、证据约束的研究草稿包。

### 2. 论文复现与 Benchmark 冲刺

用户给一篇论文 PDF、官方 repo、baseline 目标或失败日志。SciForge 读取论文和 README，建立复现计划，检查环境，运行 baseline，定位失败，修复脚本或配置，生成 benchmark 表和复现报告。

这个场景很硬：它证明 SciForge 不是“告诉你怎么做”，而是真的在本地工作区推进科研任务。

### 3. 从实验数据到论文图与汇报材料

用户提供自己的实验数据和参考论文图。SciForge 提取 `FigureStyleSpec`，选择受控绘图模板，生成 publication figure，做 style review 和保守 repair，再进入 Canvas 批注和 PPT Master 汇报输出。

这个场景适合做短视频，因为最终产物可视化强：图、评分、批注和 slide 都能一眼看懂。

### 4. 持续文献雷达与综述矩阵

面向 PI、博士生和课题组。SciForge 按研究 profile 持续同步新论文，生成每日 digest，并把论文的任务、方法、数据集、指标、局限和适合引用位置整理成 Living Review Matrix。

这个场景的核心不是“搜论文”，而是把文献发现变成长期可维护的研究情报。

### 5. Reviewer / Rebuttal Mode：审稿与回复冲刺

输入论文草稿或 reviewer comments。SciForge 抽取关键 claim，连接证据来源，构建 claim-evidence 表，找 unsupported / fragile claim，拆解审稿意见，生成补实验计划和 response letter 草稿。

这个场景适合强调可信科研：SciForge 不只是帮你润色，而是帮你判断哪些话站得住、哪些需要补证据。

### 6. 数据集体检与可信分析报告

输入公开数据集、标注文件或数据处理脚本。SciForge 检查缺失值、异常值、重复样本、标签泄漏、批次效应和分布偏移，生成可视化报告和后续分析建议。

这个场景落地稳定，适合 AI/ML 团队、企业研发和课程/教学演示。

### 7. 自动化实验巡检与异常追踪

SciForge 定时检查训练、仿真或数据处理任务，读取日志和指标文件，发现失败、性能退化、异常结果或指标漂移，关联最近代码/参数/数据变化，生成实验巡检报告和修复建议。

它比抽象的“项目管理”更实，能展示 Schedule、Workflow、Code、Research Memory 和 Evidence DAG 的组合价值。

### 8. 导师-博士生周循环

学生每天用 SciForge 推进实验和写作，PI 每周只看自动整理的 weekly status：本周完成、关键证据、失败点、阻塞、需要导师确认的问题和下周计划。

这个场景保留一个真实科研合作入口，但不展开成泛协作平台叙事。它的价值是让研究项目在多人之间保持连续、可追踪、可复盘。

### 9. 科学对象解析与文献交叉验证

用户上传或引用 FASTA、PDB/mmCIF、SMILES/SDF/MOL、单细胞表达或 marker list。Model Router 将对象交给科学多模态 translator，生成带 provenance 的文本 evidence，再由主 Agent 联合文献做交叉验证和实验建议。

这个场景证明 SciForge 面向科学对象，而不是只会读 PDF 或聊天。

### 10. 从论文 Methods 到可执行实验协议

用户选择论文的 Methods、补充材料、代码片段或实验约束。SciForge 将方法描述拆成可执行协议：实验步骤、关键变量、control 设置、材料/设备/数据依赖、质量检查点、统计分析计划和风险提示。

这个场景和“论文复现”不同：复现强调跑通代码或结果；这里强调把论文方法转成实验室或研发团队可以执行和检查的 SOP。它适合湿实验、计算实验和企业研发评估。

典型展示物：

- step-by-step SOP
- 变量与 control 对照表
- 材料、设备、数据依赖清单
- 失败风险与质量检查表
- 统计/分析计划
- 可导出的实验协议文档

### 11. ImageJ / Fiji 显微图像定量

用户提供显微图像和定量目标，例如细胞计数、斑点数量、荧光强度或 ROI 面积。SciForge 通过 Computer Use 操作 ImageJ / Fiji：打开图像、设置阈值、选择 ROI、运行 measurement、导出结果 CSV，并生成定量摘要。

这个场景适合验证 Computer Use，因为很多显微图像工作流依赖成熟桌面 GUI，且用户更关心可复查的标注图和 measurements.csv，而不是纯文本建议。

### 12. GraphPad Prism / Origin 出图与统计

用户提供实验数据表、分组信息和统计检验要求。SciForge 通过 Computer Use 导入数据、选择统计检验、生成论文图、检查图例/坐标/显著性标记，并导出 PNG/PDF。

这个场景适合展示“科研 GUI 闭环”：SciForge 不替代 Prism / Origin，而是把数据、统计、出图和最终 artifact 纳入同一个研究工作台。

### 13. PyMOL / ChimeraX 结构可视化

用户提供 PDB/mmCIF、突变位点、配体、口袋或结构域说明。SciForge 通过 Computer Use 操作 PyMOL / ChimeraX：加载结构、设置 cartoon/surface/ligand 视图、高亮关键残基、调整视角，导出结构图和图注草稿。

这个场景适合连接科学多模态能力和视觉 artifact 产出：Model Router / scientific modality 负责解释科学对象，Computer Use 负责驱动专业 GUI 生成可发表的结构视图。

## 不单独呈现的场景

这些场景不是没有价值，而是更适合作为上述案例的子环节：

| 场景 | 处理方式 |
| --- | --- |
| 项目交接 / 新人接手 | 画面弱，容易像文档整理；并入 Research Memory 能力说明 |
| 基金 / 课题申请冲刺 | 偏写作包装，与连续科研冲刺和文献综述重叠 |
| 跨实验室复现合作 | 作为论文复现案例的扩展叙事，不单列 |
| 多作者论文协同 | 并入连续科研冲刺和导师-博士生周循环 |
| Hot Topic War Room | 并入持续文献雷达 |
| 公共结论发布前证据审计 | 并入 Reviewer / Rebuttal Mode |
| 自动化文献综述流水线 | 作为持续文献雷达的实现方式，不单列 |
| 负结果与决策复盘 | 当前表述偏虚；只有能做成失败实验归因、run 对比和下一轮实验设计时再考虑单独呈现 |

## 推荐呈现层级

| 层级 | 场景 |
| --- | --- |
| 首页 / 路演主线 | 1、2、3、4、5 |
| 案例页补充 | 6、7、8 |
| 技术差异化深水区 | 9、10 |
| Computer Use 测试场景 | 11、12、13 |
