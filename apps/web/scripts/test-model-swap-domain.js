"use strict";

const assert = require("node:assert/strict");
const {
  normalizeModelSwapConfig,
  validateModelSwapBatch,
  evaluateModelSwapSafety,
} = require("./model-swap-domain");

const HUMAN_INPUT = {
  mode: "replace_model",
  subjectKind: "human",
  genderPresentation: "female",
  ageGroup: "adult",
  country: "  United   States  ",
  region: "  New   York ",
  humanAppearance: "East Asian, dark hair",
  petSpecies: "dog",
  petBreed: "Shiba Inu",
  garmentType: "top",
  scene: "studio",
  candidateCount: 99,
};

const PET_INPUT = {
  mode: "product_to_model",
  subjectKind: "pet",
  genderPresentation: "male",
  ageGroup: "adult",
  country: " Japan ",
  region: "  Tokyo ",
  humanAppearance: "not applicable",
  petSpecies: "dog",
  petBreed: "Shiba Inu",
  garmentType: "pet_clothing",
  scene: "home",
};

const human = normalizeModelSwapConfig(HUMAN_INPUT);
assert.equal(human.mode, "replace_model", "existing-model replacement mode must be retained");
assert.equal(human.subjectKind, "human");
assert.equal(human.country, "United States", "country whitespace must be normalized");
assert.equal(human.region, "New York", "region whitespace must be normalized");
assert.equal(human.candidateCount, 2, "every source image must produce exactly two candidates");
assert.equal(human.petSpecies, "", "human selections must clear pet-only fields");
assert.equal(human.petBreed, "", "human selections must clear pet-only fields");

const pet = normalizeModelSwapConfig(PET_INPUT);
assert.equal(pet.mode, "product_to_model", "product-to-model mode must be retained");
assert.equal(pet.subjectKind, "pet");
assert.equal(pet.petSpecies, "dog");
assert.equal(pet.petBreed, "Shiba Inu");
assert.equal(pet.genderPresentation, "", "pet selections must clear human-only gender fields");
assert.equal(pet.humanAppearance, "", "pet selections must clear human-only appearance fields");

const tooManyFiles = Array.from({ length: 16 }, (_, index) => ({ name: `source-${index}.png` }));
const tooManyResult = validateModelSwapBatch(tooManyFiles, human);
assert.equal(tooManyResult.ok, false, "batches over fifteen source images must be rejected");
assert.match(tooManyResult.errors.join(" "), /15/);
assert.deepEqual(validateModelSwapBatch(tooManyFiles.slice(0, 15), human), { ok: true, errors: [] });

const unsafeMinor = normalizeModelSwapConfig({
  ...HUMAN_INPUT,
  ageGroup: "teen",
  garmentType: "lingerie",
  scene: "studio",
});
assert.deepEqual(evaluateModelSwapSafety(unsafeMinor), {
  allowed: false,
  reason: "Minors cannot be shown in adultized, revealing, or sexually suggestive clothing.",
});

const unsafeScene = normalizeModelSwapConfig({
  ...HUMAN_INPUT,
  ageGroup: "child",
  garmentType: "children_clothing",
  scene: "nightclub",
});
assert.deepEqual(evaluateModelSwapSafety(unsafeScene), {
  allowed: false,
  reason: "Minors are limited to normal children’s clothing and family or commercial settings.",
});

assert.deepEqual(evaluateModelSwapSafety(normalizeModelSwapConfig({
  ...HUMAN_INPUT,
  ageGroup: "child",
  garmentType: "children_clothing",
  scene: "family_home",
  humanAppearance: "hair:black,skin:medium,body:average",
})), { allowed: true, reason: "" });

for (const garmentType of ["thong", "see-through adult costume", "adultized styling"]) {
  const result = evaluateModelSwapSafety(normalizeModelSwapConfig({
    ...HUMAN_INPUT,
    ageGroup: "teen",
    garmentType,
    scene: "studio",
  }));
  assert.equal(result.allowed, false, `minor garment must fail closed: ${garmentType}`);
  assert.match(result.reason, /minor|children/i);
}

const sexualizedPose = evaluateModelSwapSafety(normalizeModelSwapConfig({
  ...HUMAN_INPUT,
  ageGroup: "child",
  garmentType: "children_clothing",
  scene: "sexualized_pose",
}));
assert.equal(sexualizedPose.allowed, false, "sexualized poses must be rejected for minors");

for (const humanAppearance of [
  "sexually suggestive pose",
  "revealing lingerie styling",
  "nude presentation",
  "SeXuAlLy-SuGgEsTiVe_PoSe",
]) {
  const result = evaluateModelSwapSafety(normalizeModelSwapConfig({
    ...HUMAN_INPUT,
    ageGroup: "child",
    garmentType: "children_clothing",
    scene: "studio",
    humanAppearance,
  }));
  assert.equal(result.allowed, false, `minor free-text appearance must fail closed: ${humanAppearance}`);
  assert.match(result.reason, /minor|children/i);
}

for (const humanAppearance of ["", "hair:black,skin:medium,body:average"]) {
  assert.deepEqual(evaluateModelSwapSafety(normalizeModelSwapConfig({
    ...HUMAN_INPUT,
    ageGroup: "child",
    garmentType: "children_clothing",
    scene: "studio",
    humanAppearance,
  })), { allowed: true, reason: "" }, `safe structured minor appearance must be allowed: ${humanAppearance}`);
}

const adultAppearance = evaluateModelSwapSafety(normalizeModelSwapConfig({
  ...HUMAN_INPUT,
  ageGroup: "adult",
  garmentType: "top",
  scene: "studio",
  humanAppearance: "nude presentation with revealing lingerie styling",
}));
assert.deepEqual(adultAppearance, { allowed: true, reason: "" },
  "adult appearance descriptions remain governed by the normal adult flow");

const unknownMinorAge = normalizeModelSwapConfig({
  ...HUMAN_INPUT,
  ageGroup: "minor",
  garmentType: "thong",
});
assert.notEqual(unknownMinorAge.ageGroup, "adult", "unknown explicit ages must not become adults");
assert.equal(evaluateModelSwapSafety(unknownMinorAge).allowed, false);

const defaultedEnums = {
  country: "Canada",
  region: "Ontario",
  garmentType: "top",
  scene: "studio",
};
assert.equal(validateModelSwapBatch([{ name: "source.png" }], defaultedEnums).ok, true,
  "the public validator must apply defaults for omitted enum fields");

for (const [field, value] of [
  ["mode", "magic_mode"],
  ["subjectKind", "vehicle"],
  ["genderPresentation", "robot"],
  ["ageGroup", "minor"],
]) {
  const invalid = { ...HUMAN_INPUT, [field]: value, candidateCount: 2 };
  const validation = validateModelSwapBatch([{ name: "source.png" }], invalid);
  assert.equal(validation.ok, false, `invalid explicit ${field} must be rejected`);
  assert.match(validation.errors.join(" "), new RegExp(field, "i"));
}

const normalizedNull = normalizeModelSwapConfig(null);
assert.equal(normalizedNull.mode, "replace_model");
assert.equal(normalizedNull.candidateCount, 2);
const nullSafety = evaluateModelSwapSafety(null);
assert.equal(typeof nullSafety.allowed, "boolean");
assert.equal(typeof nullSafety.reason, "string");
assert.equal(nullSafety.allowed, false, "missing safety config must fail closed");

console.log("model-swap-domain tests passed");
