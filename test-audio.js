const assert = require('assert');

// محاكاة دالة تحليل طيف الصوت الموجودة في السيرفر
function analyzeAudioSpectrum(audioBuffer) {   
  if (!audioBuffer || audioBuffer.length < 50) return null;   
     
  let sumChanges = 0;   
  let maxChange = 0;   
  let sumAmplitude = 0;   
  let highPulseCount = 0;   
  const length = audioBuffer.length;   
     
  for (let i = 1; i < length; i++) {   
    const change = Math.abs(audioBuffer[i] - audioBuffer[i-1]);   
    sumChanges += change;   
    if (change > maxChange) maxChange = change;   
    sumAmplitude += Math.abs(audioBuffer[i]);   
    if (Math.abs(audioBuffer[i]) > 0.7) highPulseCount++;   
  }   
     
  const avgChange = sumChanges / (length - 1);   
  const avgAmplitude = sumAmplitude / length;   
  const pulseRatio = highPulseCount / length;   
     
  console.log("نتائج التحليل الحالية:", { avgChange, avgAmplitude, maxChange, pulseRatio });

  if (maxChange > 0.85 && pulseRatio > 0.12) return 'صراخ / إنذار 🚨';   
  if (avgChange > 0.10 && avgAmplitude > 0.3) return 'كلام بشري / ضوضاء متقطعة 🗣️';   
  if (avgChange > 0.05 && avgChange <= 0.10) return 'موسيقى / ضوضاء مستمرة 🎵';   
  if (avgChange > 0.02 && avgChange <= 0.05) return 'ضجيج خلفية 🌬️';   
  return 'هدوء نسبي 🌿';   
}

function testAnalyzeAudioSpectrum() {
    console.log("--- جاري تشغيل اختبارات تحليل الصوت ---");

    // 1. اختبار: صراخ أو إنذار
    const screamBuffer = new Array(100).fill(0).map((_, i) => (i % 5 === 0 ? 0.9 : 0));
    assert.strictEqual(analyzeAudioSpectrum(screamBuffer), 'صراخ / إنذار 🚨');

    // 2. اختبار: كلام بشري
    const speechBuffer = new Array(100).fill(0).map((_, i) => (i % 2 === 0 ? 0.8 : 0));
    assert.strictEqual(analyzeAudioSpectrum(speechBuffer), 'كلام بشري / ضوضاء متقطعة 🗣️');

    // 3. اختبار: موسيقى
    const musicBuffer = new Array(100).fill(0).map((_, i) => (i % 2 === 0 ? 0.15 : 0.07));
    assert.strictEqual(analyzeAudioSpectrum(musicBuffer), 'موسيقى / ضوضاء مستمرة 🎵');

    // 4. اختبار: ضجيج خلفية
    const backgroundBuffer = new Array(100).fill(0).map((_, i) => (i % 2 === 0 ? 0.05 : 0.02));
    assert.strictEqual(analyzeAudioSpectrum(backgroundBuffer), 'ضجيج خلفية 🌬️');

    // 5. اختبار: هدوء
    const quietBuffer = new Array(100).fill(0.01);
    assert.strictEqual(analyzeAudioSpectrum(quietBuffer), 'هدوء نسبي 🌿');

    console.log("-----------------------------------------");
    console.log("ممتاز! جميع الاختبارات نجحت بنجاح ✅");
}

try {
    testAnalyzeAudioSpectrum();
} catch (error) {
    console.error("فشل الاختبار! ❌");
    console.error(error);
    process.exit(1);
}