const tf = require('@tensorflow/tfjs');
const speechCommands = require('@tensorflow-models/speech-commands');

let recognizer;

// دالة تحميل النموذج (Pre-trained Model)
async function loadModel() {
    if (!recognizer) {
        recognizer = speechCommands.create('BROWSER_FFT');
        await recognizer.ensureModelLoaded();
        console.log("✅ خوارزمية تمييز الأصوات (Speech Commands) جاهزة!");
    }
}

// دالة تحليل "البصمة الصوتية"
async function detectSoundType(spectrogramData) {
    // الخوارزمية هنا تعتمد على تحويل فورييه السريع (FFT)
    // لمقارنة مصفوفة الترددات بالأنماط المخزنة
    const result = await recognizer.recognize(spectrogramData);
    
    // ترتيب النتائج حسب الأعلى دقة
    const scores = result.scores;
    const labels = recognizer.wordLabels();
    
    // الحصول على أعلى احتمال
    let maxScore = -1;
    let detectedLabel = "Unknown";
    
    for (let i = 0; i < scores.length; i++) {
        if (scores[i] > maxScore) {
            maxScore = scores[i];
            detectedLabel = labels[i];
        }
    }
    return { label: detectedLabel, confidence: maxScore };
}

module.exports = { loadModel, detectSoundType };