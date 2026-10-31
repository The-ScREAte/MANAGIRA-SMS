const UNIFORM_SUBJECT_SCALING_TERM_ID = -3;

function normalizeUniformSubjectScaling(value = {}) {
  const enabled = value?.enabled === true;
  const baseMaxScore = Number(value?.baseMaxScore);
  const applyToClasses = Array.isArray(value?.applyToClasses)
    ? [...new Set(value.applyToClasses.map(Number).filter((id) => Number.isInteger(id) && id > 0))]
    : [];
  return {
    enabled,
    baseMaxScore: Number.isFinite(baseMaxScore) && baseMaxScore > 0 ? baseMaxScore : 100,
    applyToClasses,
  };
}

function calculateUniformSubjectScores(assessments, scoreForAssessment, baseMaxScore, categoryForAssessment) {
  const eligible = (Array.isArray(assessments) ? assessments : [])
    .map((assessment) => {
      const maxScore = Number(assessment.max_score);
      const earnedScore = Number(scoreForAssessment(assessment));
      const assignedWeight = Number(assessment.weight);
      return {
        assessment,
        maxScore,
        earnedScore: Number.isFinite(earnedScore) ? earnedScore : 0,
        assignedWeight,
      };
    })
    .filter((entry) => Number.isFinite(entry.maxScore) && entry.maxScore > 0);

  if (!eligible.length) {
    return { totalScore: 0, maxScore: 0, categoryScores: {} };
  }

  const hasAssignedWeights = eligible.some((entry) => Number.isFinite(entry.assignedWeight) && entry.assignedWeight > 0);
  const weighted = eligible
    .map((entry) => ({
      ...entry,
      weight: hasAssignedWeights
        ? (Number.isFinite(entry.assignedWeight) && entry.assignedWeight > 0 ? entry.assignedWeight : 0)
        : entry.maxScore,
    }))
    .filter((entry) => entry.weight > 0);
  const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  if (!totalWeight) return { totalScore: 0, maxScore: 0, categoryScores: {} };

  const base = Number(baseMaxScore);
  if (!Number.isFinite(base) || base <= 0) {
    throw new RangeError("Base maximum score must be greater than zero.");
  }
  const multiplier = base / totalWeight;
  const categoryScores = {};
  let totalScore = 0;

  weighted.forEach((entry) => {
    const earnedRatio = Math.min(1, Math.max(0, entry.earnedScore / entry.maxScore));
    const scaledScore = earnedRatio * entry.weight * multiplier;
    const category = String(categoryForAssessment(entry.assessment) || "other");
    categoryScores[category] = (categoryScores[category] || 0) + scaledScore;
    totalScore += scaledScore;
  });

  return {
    totalScore: Math.min(base, totalScore),
    maxScore: base,
    categoryScores,
  };
}

module.exports = {
  UNIFORM_SUBJECT_SCALING_TERM_ID,
  normalizeUniformSubjectScaling,
  calculateUniformSubjectScores,
};
