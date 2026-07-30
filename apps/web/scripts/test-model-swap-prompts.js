"use strict";

const assert = require("node:assert/strict");
const { normalizeModelSwapConfig } = require("./model-swap-domain");
const {
  buildModelSwapPrompt,
  buildQualityPrompt,
} = require("./model-swap-prompts");

const SOURCE_FACTS = {
  visibleGarment: "navy floral blouse with a pointed collar, puff sleeves, three pearl buttons, and a small Borealos logo",
  visibleFootwear: "white low-top sneakers",
  visibleAccessories: "gold hoop earrings",
  dimensions: "4:5 portrait",
};

const humanConfig = normalizeModelSwapConfig({
  mode: "replace_model",
  subjectKind: "human",
  genderPresentation: "female",
  ageGroup: "adult",
  country: "United States",
  region: "California",
  humanAppearance: "warm medium skin, black hair",
  garmentType: "top",
  scene: "studio",
});

const firstCandidate = buildModelSwapPrompt({
  config: humanConfig,
  sourceFacts: SOURCE_FACTS,
  hasTargetReference: true,
  candidateIndex: 1,
});
const secondCandidate = buildModelSwapPrompt({
  config: humanConfig,
  sourceFacts: SOURCE_FACTS,
  hasTargetReference: false,
  candidateIndex: 2,
});

const detailedQualityPrompt = buildQualityPrompt({ sourceFacts: SOURCE_FACTS, config: humanConfig });
assert.match(detailedQualityPrompt, /check age group and country\/region/i,
  "quality review must explicitly check requested age and geography");
assert.match(detailedQualityPrompt, /check body, hands, feet, face, and hair or fur/i,
  "quality review must enumerate subject anatomy and visible identity details");
assert.match(detailedQualityPrompt, /check wearing relationship and occlusion/i,
  "quality review must inspect how the product is worn and occluded");
assert.match(detailedQualityPrompt, /check color, logo, text, pattern, texture, and silhouette/i,
  "quality review must enumerate all product-fidelity dimensions");
assert.match(detailedQualityPrompt, /check output aspect ratio and dimensions/i,
  "quality review must verify requested output geometry");

for (const prompt of [firstCandidate, secondCandidate]) {
  assert.match(prompt, /do not modify[^.]*color/i, "the product color must be immutable");
  assert.match(prompt, /do not modify[^.]*logo/i, "the product logo must be immutable");
  assert.match(prompt, /do not modify[^.]*text/i, "visible product text must be immutable");
  assert.match(prompt, /do not modify[^.]*pattern/i, "the product pattern must be immutable");
  assert.match(prompt, /do not modify[^.]*neckline/i, "the neckline must be immutable");
  assert.match(prompt, /do not modify[^.]*sleeve shape/i, "the sleeve shape must be immutable");
  assert.match(prompt, /do not modify[^.]*buttons/i, "visible buttons must be immutable");
  assert.match(prompt, /do not modify[^.]*shoe shape/i, "visible footwear shape must be immutable");
  assert.match(prompt, /do not modify[^.]*accessories/i, "visible accessories must be immutable");
  assert.match(prompt, /do not fabricate unseen garment construction/i,
    "the prompt must not invent product structure absent from the source");
  assert.match(prompt, /country and region.*must not.*race.*ethnicity/i,
    "geography must not deterministically select ethnicity");
}

assert.match(firstCandidate, /candidate-1-seed/i,
  "candidate one needs a stable, repeatable seed label");
assert.match(secondCandidate, /candidate-2-seed/i,
  "candidate two needs a distinct stable, repeatable seed label");
assert.notEqual(firstCandidate.match(/candidate-[12]-seed/i)[0], secondCandidate.match(/candidate-[12]-seed/i)[0],
  "the two candidate seed labels must be distinct");

assert.match(firstCandidate, /preserve.*pose.*composition.*lighting.*background/i,
  "replace-model mode must preserve the source arrangement");
assert.match(firstCandidate, /target reference.*preserve.*visible identity features/i,
  "a target reference must preserve its visible identity features");

const productPrompt = buildModelSwapPrompt({
  config: normalizeModelSwapConfig({
    mode: "product_to_model",
    subjectKind: "pet",
    ageGroup: "adult",
    petSpecies: "dog",
    petBreed: "shiba inu",
    garmentType: "pet_clothing",
    scene: "home",
  }),
  sourceFacts: SOURCE_FACTS,
  hasTargetReference: false,
  candidateIndex: 1,
});
assert.match(productPrompt, /natural wearing relationship/i,
  "product-to-model mode must require a natural wearing relationship");
assert.match(productPrompt, /subject.*pet/i, "pet configuration must reach the prompt");
assert.match(productPrompt, /garment type:\s*pet_clothing/i,
  "the requested garment type must explicitly reach generation");
assert.match(productPrompt, /scene:\s*home/i,
  "the requested scene must explicitly reach generation");

const minorPrompt = buildModelSwapPrompt({
  config: normalizeModelSwapConfig({
    mode: "product_to_model",
    subjectKind: "human",
    genderPresentation: "nonbinary",
    ageGroup: "child",
    garmentType: "children_clothing",
    scene: "family_home",
  }),
  sourceFacts: SOURCE_FACTS,
  hasTargetReference: false,
  candidateIndex: 1,
});
assert.match(minorPrompt, /minor safety/i, "minor prompts must carry explicit safety instructions");
assert.match(minorPrompt, /normal children's clothing.*family or commercial/i,
  "minor prompts must limit output to appropriate clothing and settings");
assert.match(minorPrompt, /no adultized.*revealing.*sexually suggestive/i,
  "minor prompts must reject sexualized presentation");

const qualityPrompt = buildQualityPrompt({ sourceFacts: SOURCE_FACTS, config: humanConfig });
assert.match(qualityPrompt, /quality check/i);
assert.match(qualityPrompt, /human or pet match/i);
assert.match(qualityPrompt, /product fidelity/i);
assert.match(qualityPrompt, /natural construction/i);
assert.match(qualityPrompt, /dimensions.*proportions/i);
assert.match(qualityPrompt, /list every issue/i);

const unsafeMinorConfig = normalizeModelSwapConfig({
  mode: "product_to_model",
  subjectKind: "human",
  genderPresentation: "female",
  ageGroup: "child",
  garmentType: "lingerie",
  scene: "studio",
});
assert.throws(() => buildModelSwapPrompt({
  config: unsafeMinorConfig,
  sourceFacts: SOURCE_FACTS,
  hasTargetReference: false,
  candidateIndex: 1,
}), (error) => {
  assert.equal(error.name, "ModelSwapSafetyError");
  assert.equal(error.code, "MODEL_SWAP_UNSAFE");
  assert.match(error.reason, /minor|children/i);
  return true;
}, "unsafe minor configurations must be rejected before prompt construction");

assert.throws(() => buildModelSwapPrompt({
  config: null,
  sourceFacts: SOURCE_FACTS,
  hasTargetReference: false,
  candidateIndex: 1,
}), (error) => error.code === "MODEL_SWAP_UNSAFE" && /valid.*configuration/i.test(error.reason),
  "prompt construction must preserve Task 1's fail-closed safety behavior");

console.log("model-swap-prompts tests passed");
