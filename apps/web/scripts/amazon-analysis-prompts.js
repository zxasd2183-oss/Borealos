"use strict";

const TEACHING_SHAPE = {
  itemAnalyses: [{
    itemId: "输入中的原值",
    priority: "high|medium|low",
    dataBasis: "包含实际值、比较值或数据范围",
    reason: "判断原因",
    consolePath: "可定位该数据或执行动作的系统路径；没有后台时写数据源 > 工作表 > 行号",
    steps: ["步骤1", "步骤2"],
    adjustment: "明确数值范围，或说明仅观察不调整",
    observationWindow: "观察时间或复核周期",
    successCriteria: "可量化成功标准",
    rollbackCondition: "明确回滚或停止条件",
  }],
};

function buildAmazonBatchMessages(metrics, batch) {
  if (metrics && metrics.reportType === "universal") {
    const context = {
      reportType: metrics.reportTypeName || metrics.reportType,
      sheets: metrics.sheets || [],
      columns: metrics.columns || [],
    };
    return [
      {
        role: "system",
        content: "你是通用数据分析与教学专家。先识别字段含义和每行代表的实体，再归纳数值、日期、分类之间的关系与异常。必须逐项解释输入 items，不得遗漏、重复或编造 itemId；不得套用输入中不存在的业务指标。只输出合法 JSON。",
      },
      {
        role: "user",
        content: "报告结构概况：\n" + JSON.stringify(context) +
          "\n\n分析以下完整批次：\n" + JSON.stringify(batch) +
          "\n对每项先说明数据依据和含义，再给出可验证的解释或行动；没有业务后台时，consolePath 使用“数据源 > 工作表 > 行号”。只返回此结构：" +
          JSON.stringify(TEACHING_SHAPE),
      },
    ];
  }

  return [
    {
      role: "system",
      content: "你是亚马逊 PPC 教练。必须逐项分析输入 items，并且只输出合法 JSON。不得遗漏、重复或编造 itemId。每项建议必须引用数据、给出后台路径、编号步骤、调整幅度、观察窗口、成功标准和回滚条件。",
    },
    {
      role: "user",
      content: "分析以下完整批次：\n" + JSON.stringify(batch) +
        "\n只返回此结构：" + JSON.stringify(TEACHING_SHAPE),
    },
  ];
}

function buildAmazonSummaryMessages(metrics, merged, ruleFindings) {
  const summaryPayload = {
    reportType: metrics.reportTypeName || metrics.reportType,
    totals: metrics.totals || {},
    sheets: metrics.reportType === "universal" ? (metrics.sheets || []) : undefined,
    coverage: merged.coverage,
    ruleFindings: ruleFindings || [],
    aggregateEvidence: merged.aggregateEvidence || undefined,
    priorityCounts: (merged.itemAnalyses || []).reduce((counts, item) => {
      counts[item.priority] = (counts[item.priority] || 0) + 1;
      return counts;
    }, {}),
  };
  const outputShape = {
    overview: "总体评价",
    issues: [{
      severity: "high|medium|low",
      title: "问题标题",
      detail: "问题分析",
      dataBasis: "数据依据",
    }],
    actions: { now: ["立即操作"], week: ["本周操作"], ongoing: ["持续操作"] },
  };
  if (metrics.reportType === "universal") {
    return [
      {
        role: "system",
        content: "你是通用数据分析专家。根据字段 profile、工作表结构、逐项覆盖率和优先级归纳报告用途、数据结构、主要关系、异常与可验证结论。不要假设输入中没有出现的业务概念。只输出 JSON。",
      },
      {
        role: "user",
        content: "逐项分析已经结束。根据以下结构化结果生成全局解释：\n" +
          JSON.stringify(summaryPayload) + "\n只返回：" + JSON.stringify(outputShape),
      },
    ];
  }
  return [
    {
      role: "system",
      content: "你是亚马逊 PPC 广告优化专家。只根据给定聚合信息生成全局总结，只输出 JSON。",
    },
    {
      role: "user",
      content: "批次逐项分析已经结束。根据以下数据生成全局总结：\n" +
        JSON.stringify(summaryPayload) + "\n只返回：" + JSON.stringify(outputShape),
    },
  ];
}

module.exports = {
  TEACHING_SHAPE,
  buildAmazonBatchMessages,
  buildAmazonSummaryMessages,
};
