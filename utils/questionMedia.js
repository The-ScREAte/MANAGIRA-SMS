"use strict";
// Pictures on test questions. Any question can show a picture; a "label the picture"
// question (image_label) also has numbered spots on it, each with its answer, and the student
// types an answer for each spot. Pictures are kept with the school's other images
// (images/questions/<school>/...) and shown through the signed /public-image route.
const crypto = require("crypto");

const TYPES = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" };
const MAX_LABELS = 20;
const MAX_ANSWER = 200;

const keyPattern = (organizationId) => new RegExp(`^images/questions/${Number(organizationId)}/[A-Za-z0-9-]{8,64}\\.(png|jpg|webp|gif)$`);
const clamp01 = (value) => Math.round(Math.min(Math.max(Number(value), 0), 1) * 10000) / 10000;

// A question's picture and spots as saved, or why they can't be.
function checkMedia(question, organizationId) {
  const raw = question && question.media && typeof question.media === "object" ? question.media : null;
  const key = raw && raw.image && typeof raw.image === "object" ? String(raw.image.key || "") : "";
  const isLabel = question.questionType === "image_label";
  if (!key) {
    if (isLabel) return { error: "add the picture students will label." };
    return { media: null };
  }
  if (!keyPattern(organizationId).test(key)) return { error: "that picture couldn't be used. Upload it again." };
  const alt = String((raw.image && raw.image.alt) || "").replace(/\s+/g, " ").trim().slice(0, 200);
  const media = { image: { key, alt } };
  if (!isLabel) return { media };

  const labels = (Array.isArray(raw.labels) ? raw.labels : []).slice(0, MAX_LABELS + 1);
  if (!labels.length) return { error: "click the picture to add the spots students will label." };
  if (labels.length > MAX_LABELS) return { error: `use at most ${MAX_LABELS} spots.` };
  const clean = [];
  for (let i = 0; i < labels.length; i += 1) {
    const label = labels[i] || {};
    const answer = String(label.answer || "").replace(/\s+/g, " ").trim();
    if (!answer) return { error: `type the answer for spot ${i + 1}.` };
    if (answer.length > MAX_ANSWER) return { error: `the answer for spot ${i + 1} is too long.` };
    if (!Number.isFinite(Number(label.x)) || !Number.isFinite(Number(label.y))) return { error: `place spot ${i + 1} on the picture again.` };
    clean.push({ x: clamp01(label.x), y: clamp01(label.y), answer });
  }
  media.labels = clean;
  return { media, answerKey: clean.map((label) => label.answer).join(" | ") };
}

// Keeps a picture for this school; returns its key.
async function storeImage(file, organizationId) {
  const extension = TYPES[String(file && file.mimetype || "").toLowerCase()];
  if (!extension) {
    const error = new Error("Use a PNG, JPG, WEBP or GIF picture.");
    error.status = 400;
    throw error;
  }
  const key = `images/questions/${Number(organizationId)}/${crypto.randomUUID()}${extension}`;
  const { uploadToS3 } = require("../middleware/s3Upload");
  await uploadToS3(file, key);
  return key;
}

// The media as a page or the builder shows it: the picture's signed address added, the
// answers left out unless asked for (a student's page never gets them).
function forDisplay(media, imageUrl, { withAnswers = false } = {}) {
  if (!media || typeof media !== "object" || !media.image || !media.image.key) return null;
  const shown = { image: { key: media.image.key, alt: media.image.alt || "", url: imageUrl(media.image.key) } };
  if (Array.isArray(media.labels)) {
    shown.labels = media.labels.map((label) => (withAnswers
      ? { x: label.x, y: label.y, answer: label.answer }
      : { x: label.x, y: label.y }));
  }
  return shown;
}

const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();

// Marks for a "label the picture" answer: an equal share of the question's marks for each
// spot answered right. An answer may list alternatives with "/" ("heart / the heart").
function markLabels(question, rawResponse) {
  const media = typeof question.media_json === "string" ? safeParse(question.media_json) : question.media_json;
  const labels = media && Array.isArray(media.labels) ? media.labels : [];
  const given = Array.isArray(rawResponse)
    ? rawResponse
    : (rawResponse && typeof rawResponse === "object" ? Object.keys(rawResponse).sort((a, b) => Number(a) - Number(b)).map((k) => rawResponse[k]) : [rawResponse]);
  const marks = Number(question.marks || 0);
  if (!labels.length) return { isCorrect: null, awardedMarks: 0, values: given.map((v) => String(v || "")) };
  let right = 0;
  const values = labels.map((label, index) => {
    const answer = String(given[index] === undefined || given[index] === null ? "" : given[index]).slice(0, MAX_ANSWER);
    const accepted = String(label.answer || "").split("/").map(normalize).filter(Boolean);
    if (answer.trim() && accepted.includes(normalize(answer))) right += 1;
    return answer;
  });
  const awarded = Math.round((marks * right / labels.length) * 100) / 100;
  return { isCorrect: right === labels.length, awardedMarks: awarded, values, right, total: labels.length };
}

function safeParse(value) {
  try { return JSON.parse(value); } catch (_) { return null; }
}

module.exports = { checkMedia, storeImage, forDisplay, markLabels, MAX_LABELS };
