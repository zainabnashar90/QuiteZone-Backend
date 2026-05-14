const express = require('express');
const router = express.Router();
const Place = require('../models/Place'); 

// المسار الذكي للبحث عن أهدأ منطقة
router.get('/recommend-path', async (req, res) => {
    const { lat, lng } = req.query;
    try {
        const noiseSpots = await Place.find({
            "location.lat": { $gte: parseFloat(lat) - 0.05, $lte: parseFloat(lat) + 0.05 },
            "location.lng": { $gte: parseFloat(lng) - 0.05, $lte: parseFloat(lng) + 0.05 }
        });

        const quietOptions = noiseSpots.filter(spot => spot.noiseLevel < 60);

        if (quietOptions.length === 0) {
             return res.json({ success: false, message: "لا توجد مسارات هادئة مرصودة حالياً." });
        }

        const bestRoute = quietOptions.sort((a, b) => a.noiseLevel - b.noiseLevel)[0];

        res.json({
            success: true,
            bestRoute: bestRoute,
            recommendation: `المسار الأفضل هو ${bestRoute.name} بمعدل ضجيج ${bestRoute.noiseLevel} dB.`
        });
    } catch (err) {
        res.status(500).json({ error: "خطأ في السيرفر" });
    }
});

module.exports = router;