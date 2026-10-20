'use strict';

const TIPS = Object.freeze([
  '站起来慢慢走几十步，让腰背从固定姿势里放松一下。',
  '起身接杯水，走动一两分钟，回来时再顺手把坐姿调正。',
  '离开椅子走一走，双脚踏实、肩膀放松，不必急着回到屏幕前。',
  '把视线抬高一点，站直自然呼吸几次；动作以舒服为准。',
  '去窗边站一会儿，活动一下肩颈和小腿，再回到工作。',
  '这一段坐得够久了。起身走动两分钟，让身体换个姿势。',
  '站起来时先稳住重心，慢走一会儿即可，不要立刻弯腰搬重物。',
  '坐久了腰背容易僵，起身走一小圈，回来再继续。',
  '休息一下眼睛，也离开椅子活动两步；回座时检查屏幕高度。',
  '起来站稳，双肩放松、双脚踩实，让身体从久坐中缓一缓。',
]);

const DISCLAIMER =
  '本工具仅提供久坐提醒，不构成医疗建议。若疼痛、麻木或无力持续或加重，请停止活动并咨询医生。';

const SHORT_DISCLAIMER =
  '如起身时疼痛或腿麻加重，请停止活动并咨询医生。';

function pickTip(sequence = 0) {
  const index = Math.abs(Math.floor(Number(sequence) || 0)) % TIPS.length;
  return TIPS[index];
}

module.exports = {
  DISCLAIMER,
  SHORT_DISCLAIMER,
  TIPS,
  pickTip,
};
