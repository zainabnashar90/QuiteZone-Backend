require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const mongoose = require('mongoose');
const cors = require('cors');
const { Expo } = require('expo-server-sdk');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));


const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const expo = new Expo();
const PORT = process.env.PORT || 5000;

const dbURI = process.env.MONGODB_URI;

// 1. الاتصال بقاعدة البيانات بشكل مستقل
mongoose.connect(dbURI)
  .then(() => {
    console.log("✅ Awesome! QuiteZone is now connected to MongoDB Atlas");
  })
  .catch((err) => {
    console.log("❌ Connection error:", err);
  });

// 2. تشغيل السيرفر خارج بلوك الاتصال لضمان عدم التكرار
server.listen(PORT, '0.0.0.0', () => {
    console.log(`
      ════════════════════════════════════════════
      📍 NoiseHunter Server: ONLINE
      📡 Port: ${PORT}
      🔗 Stats: https://quitezone-backend.onrender.com/api/stats
      🔌 Socket.IO: مفعّل
      🤖 AI Analysis: محلل طيف (بديل YAMNet)
      ════════════════════════════════════════════
    `);
});
const Place = mongoose.model('Place', new mongoose.Schema({
  name: String,
  location: { lat: Number, lng: Number },
  noiseLevel: Number,
  noiseType: { type: String, default: 'هدوء نسبي' },
  aiDetectedSource: { type: String, default: '' },
  isAlert: { type: Boolean, default: false },
  updatedAt: { type: Date, default: Date.now }
}));

const activeDevices = new Map();
const registeredPushTokens = new Map();

// ✅ FIX 3: cooldown بالسيرفر — مرة كل 60 ثانية لكل token
const lastPushSentTime = new Map();
const PUSH_COOLDOWN_MS = 60000;

// ==========================================
// 🔔 إرسال Push Notification
// ==========================================
async function sendPushNotification(pushToken, title, body, data = {}) {
  if (!Expo.isExpoPushToken(pushToken)) {
    console.log(`❌ توكن غير صالح: ${pushToken}`);
    return false;
  }

 const messages = [{
    to: pushToken,
    sound: 'default', // تأكدي أن الصوت مفعل
    title,
    body,
    // أضيفي هذه الخصائص لضمان الاستيقاظ في الخلفية
    data: { 
        ...data, 
        displayInForeground: true 
    },
    priority: 'high', // ضروري جداً لتنبيه الأندرويد حتى لو كان نائماً
    channelId: 'noise_alerts', // يجب أن يتطابق تماماً مع اسم القناة في الفرونت آند
    android: {
        channelId: 'noise_alerts',
        vibrationPattern: [0, 250, 250, 250],
        priority: 'max', // أعلى أولوية للأندرويد
        sticky: false,   // لكي لا يعلق الإشعار ويستطيع المستخدم مسحه
    }
}];

  try {
    const chunks = expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      const tickets = await expo.sendPushNotificationsAsync(chunk);
      tickets.forEach(ticket => {
        if (ticket.status === 'error') {
          console.log('❌ Notification error:', ticket.message);
        }
      });
    }
    console.log(`✅ إشعار أُرسل إلى: ${pushToken}`);
    return true;
  } catch (err) {
    console.log('❌ فشل إرسال الإشعار:', err.message);
    return false;
  }
}

// ✅ FIX 2+3: broadcast مع cooldown — لا يرسل لنفس الجهاز مرتين
async function broadcastNotification(title, body, data = {}, excludeToken = null) {
  let sentCount = 0;
  const now = Date.now();
  for (const [socketId, token] of registeredPushTokens.entries()) {
    // تخطي الجهاز المرسل (لأنه بيرسله بشكل منفصل)
    if (token === excludeToken) continue;
    // تطبيق الـ cooldown لكل جهاز
    const lastSent = lastPushSentTime.get(token) || 0;
    if (now - lastSent < PUSH_COOLDOWN_MS) continue;
    lastPushSentTime.set(token, now);
    const ok = await sendPushNotification(token, title, body, data);
    if (ok) sentCount++;
  }
  return sentCount;
}

// ==========================================
// 🤖 تحليل الصوت
// ==========================================
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
  
  if (maxChange > 0.85 && pulseRatio > 0.12) return 'صراخ / إنذار 🚨';
  if (avgChange > 0.10 && avgAmplitude > 0.3) return 'كلام بشري / ضوضاء متقطعة 🗣️';
  if (avgChange > 0.05 && avgChange <= 0.10) return 'موسيقى / ضوضاء مستمرة 🎵';
  if (avgChange > 0.02 && avgChange <= 0.05) return 'ضجيج خلفية 🌬️';
  return 'هدوء نسبي 🌿';
}

async function getAIClassification(audioBuffer) {
  if (!audioBuffer || audioBuffer.length < 100) return null;
  try {
    let maxVal = 0;
    for (let i = 0; i < audioBuffer.length; i++) {
      const absVal = Math.abs(audioBuffer[i]);
      if (absVal > maxVal) maxVal = absVal;
    }
    let normalizedBuffer;
    if (maxVal === 0 || maxVal === 1) {
      normalizedBuffer = audioBuffer;
    } else {
      const scale = 1 / maxVal;
      normalizedBuffer = new Array(audioBuffer.length);
      for (let i = 0; i < audioBuffer.length; i++) {
        normalizedBuffer[i] = audioBuffer[i] * scale;
      }
    }
    const sampleSize = Math.min(normalizedBuffer.length, 1500);
    return analyzeAudioSpectrum(normalizedBuffer.slice(0, sampleSize));
  } catch (err) {
    console.log('AI Classification Error:', err);
    return null;
  }
}

// ==========================================
// 🧠 تصنيف الضوضاء
// ==========================================
function classifyNoise(noiseLevel, audioFeatures = [], aiSource = null) {
  let avgChange = 0;
  if (audioFeatures.length >= 2) {
    let totalChange = 0;
    for (let i = 1; i < audioFeatures.length; i++) {
      totalChange += Math.abs(audioFeatures[i] - audioFeatures[i - 1]);
    }
    avgChange = totalChange / (audioFeatures.length - 1);
  }

  const isAiEmergency = aiSource && (aiSource.includes('إنذار') || aiSource.includes('صراخ'));
  
  if (noiseLevel > 85 && (avgChange > 15 || isAiEmergency))
    return { detectedType: 'صراخ / إنذار 🚨', isEmergency: true };
  if (noiseLevel > 90)
    return { detectedType: 'ضجيج خطير ⚠️', isEmergency: true };
  if (noiseLevel > 75)
    return { detectedType: aiSource || 'ضجيج مرتفع 🔊', isEmergency: true };

  return { detectedType: 'هدوء نسبي 🌿', isEmergency: false };
}

// ==========================================
// 📏 المسافة بين نقطتين (Haversine)
// ==========================================
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return (R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(2);
}

// ==========================================
// 🌍 Reverse Geocode
// ==========================================
async function reverseGeocode(lat, lng) {
  // استخدام AbortController للتعامل مع التوقيت (Timeout) بشكل صحيح
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=ar&zoom=18`;
    
    const resp = await fetch(url, { 
      headers: { 'User-Agent': 'QuiteZone_App_Graduation_Project' },
      signal: controller.signal // ربط التوقيت بطلب الـ fetch
    });

    clearTimeout(timeoutId);
    const geo = await resp.json();
    
    if (!geo || !geo.address) throw new Error("No address found");

    const addr = geo.address;
    
    // تحسين ترتيب المسميات لتشمل المعالم (Amenities) مثل اسم "كلية الهمك" أو "حديقة الجلاء"
    const placeName = addr.amenity || addr.building || addr.road || addr.suburb || addr.neighbourhood || addr.city;
    const districtName = addr.suburb || addr.city_district || "";
    const cityName = addr.city || addr.town || addr.state || "";

    // تنسيق الاسم النهائي بشكل جذاب
    let finalAddress = "";
    if (placeName) finalAddress += placeName;
    if (districtName && districtName !== placeName) finalAddress += `، ${districtName}`;
    else if (cityName && cityName !== placeName) finalAddress += `، ${cityName}`;

    return finalAddress || "موقع مرصود";

  } catch (err) {
    // في حال فشل الإنترنت أو السيرفر، نعرض الإحداثيات كخطة بديلة (Fallback)
    console.log("Geocoding Error:", err);
    return `📍 إحداثيات: ${lat.toFixed(3)}, ${lng.toFixed(3)}`;
  }
}

// ==========================================
// 🔌 Socket.IO
// ==========================================
io.on('connection', async (socket) => {
  console.log(`📱 اتصال جديد (ID: ${socket.id})`);

  try {
    const recentHistory = await Place.find().sort({ updatedAt: -1 }).limit(50);
    socket.emit('update-history', recentHistory.map(item => ({
      lat: item.location.lat,
      lng: item.location.lng,
      noiseLevel: item.noiseLevel,
      time: item.updatedAt
    })));
  } catch (err) {
    console.log('❌ فشل إرسال السجل الأولي:', err.message);
  }

  socket.on('register-device', (data) => {
    const device = {
      socketId: socket.id,
      deviceName: data.deviceName || 'جهاز مجهول',
      localIP: data.localIP || '0.0.0.0',
      pushToken: data.pushToken || null,
      connectedAt: new Date().toISOString()
    };
    activeDevices.set(socket.id, device);

    if (data.pushToken && Expo.isExpoPushToken(data.pushToken)) {
      registeredPushTokens.set(socket.id, data.pushToken);
      console.log(`🔔 Push Token مسجّل للجهاز: ${device.deviceName}`);
    }

    console.log(`✅ مسجّل: ${device.deviceName}`);
    io.emit('update-device-list', Array.from(activeDevices.values()));
  });

  socket.on('disconnect', () => {
    activeDevices.delete(socket.id);
    registeredPushTokens.delete(socket.id);
    console.log(`📴 انقطع الاتصال (ID: ${socket.id})`);
    io.emit('update-device-list', Array.from(activeDevices.values()));
  });
});

// ==========================================
// POST /api/analyze-audio
// ==========================================
app.post('/api/analyze-audio', async (req, res) => {
  try {
    const { location, noiseLevel, audioFeatures, isMuted, pushToken, rawAudio } = req.body;

    if (!location?.lat || !location?.lng || noiseLevel === undefined) {
      return res.status(400).json({ success: false, error: 'بيانات غير مكتملة' });
    }

    let aiSource = '';
    if (rawAudio && rawAudio.length > 100) {
      aiSource = await getAIClassification(rawAudio);
    }
    
    const { detectedType, isEmergency } = classifyNoise(noiseLevel, audioFeatures || [], aiSource);
    const address = await reverseGeocode(location.lat, location.lng);
    const finalNoiseType = aiSource || detectedType;
    
    const newRecord = new Place({
      name: address, 
      location, 
      noiseLevel, 
      noiseType: finalNoiseType,
      aiDetectedSource: aiSource || detectedType,
      isAlert: isEmergency, 
      updatedAt: new Date() 
    });
    await newRecord.save();
    
    const updatedHistory = await Place.find().sort({ updatedAt: -1 }).limit(50);
    io.emit('update-history', updatedHistory.map(p => ({
      lat: p.location.lat, lng: p.location.lng,
      noiseLevel: p.noiseLevel, time: p.updatedAt
    })));
    
    if (isEmergency && !isMuted) {
      const title = "🤫 يرجى الهدوء - QuietZone";
      const body = `رصدنا ضجيجاً بمستوى ${noiseLevel} dB في ${address.split(',')[0]}. لطفاً، حافظ على سكينة المكان 🌿`;
      const now = Date.now();

      // ✅ FIX 2+3: إرسال للجهاز المرسل مع cooldown (مرة كل دقيقة)
      if (pushToken && Expo.isExpoPushToken(pushToken)) {
        const lastSent = lastPushSentTime.get(pushToken) || 0;
        if (now - lastSent >= PUSH_COOLDOWN_MS) {
          lastPushSentTime.set(pushToken, now);
          await sendPushNotification(pushToken, title, body, {
            type: 'NOISE_ALERT',
            lat: location.lat,
            lng: location.lng,
            displayInForeground: true
          });
        }
      }

      // ✅ FIX 2: broadcast للأجهزة الأخرى فقط (excludeToken يمنع الإرسال المزدوج)
      await broadcastNotification(title, body, { 
        type: 'NOISE_ALERT', 
        lat: location.lat, 
        lng: location.lng 
      }, pushToken);

      io.emit('collective-noise-alert', { location, noiseLevel, noiseType: detectedType, address });
    }

    res.json({ success: true, detectedType: finalNoiseType, isAlert: isEmergency, address });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// GET /api/stats
// ==========================================
app.get('/api/stats', async (req, res) => {
  try {
    const history = await Place.find().sort({ updatedAt: -1 }).limit(20);
    const formattedHistory = history.map(item => ({
      id: item._id.toString(),
      noiseLevel: item.noiseLevel,
      noiseType: item.noiseType,
      time: item.updatedAt,
      name: item.name
    }));
    const all = await Place.find();
    const levels = all.map(p => p.noiseLevel).filter(Boolean);
    const avg = levels.length ? Math.round(levels.reduce((a, b) => a + b, 0) / levels.length) : 0;
    const maxLevel = levels.length ? Math.max(...levels) : 0;
    const maxPlace = all.find(p => p.noiseLevel === maxLevel);
    res.json({
      success: true,
      history: formattedHistory,
      summary: {
        totalRecords: all.length,
        avgNoiseLevel: avg,
        maxNoiseLevel: maxLevel,
        maxNoiseName: maxPlace?.name || ''
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// GET /api/heatmap
// ==========================================
app.get('/api/heatmap', async (req, res) => {
  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const points = await Place.find({ updatedAt: { $gte: oneDayAgo } })
      .select('location noiseLevel noiseType isAlert name updatedAt')
      .sort({ updatedAt: -1 })
      .limit(100);
    res.json({ success: true, points });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// GET /api/devices
// ==========================================
app.get('/api/devices', (req, res) => {
  res.json({ success: true, devices: Array.from(activeDevices.values()) });
});

// ==========================================
// POST /api/magic-wand
// ==========================================
app.post('/api/magic-wand', async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    if (!latitude || !longitude) {
      return res.json({ success: false, message: 'الموقع الجغرافي غير متوفر.' });
    }
    const userLat = parseFloat(latitude);
    const userLng = parseFloat(longitude);
    const quietPlaces = await Place.find({ noiseLevel: { $lte: 55 } });
    if (quietPlaces.length === 0) {
      return res.json({ success: false, message: 'لا توجد مناطق هادئة مرصودة حالياً في قاعدة البيانات.' });
    }
    const nearbyPlaces = quietPlaces.filter(place => {
      const distance = calculateDistance(userLat, userLng, place.location.lat, place.location.lng);
      return distance <= 50;
    });
    if (nearbyPlaces.length === 0) {
      return res.json({ success: false, message: 'لم يتم العثور على مناطق هادئة في محيط 50 كم.' });
    }
    const bestPlace = nearbyPlaces.sort((a, b) => a.noiseLevel - b.noiseLevel)[0];
    const dist = calculateDistance(userLat, userLng, bestPlace.location.lat, bestPlace.location.lng);
    res.json({
      success: true,
      message: `تم العثور على أهدأ منطقة قريبة منك في ${bestPlace.name.split(',')[0]}`,
      bestRoute: {
        name: bestPlace.name,
        location: { lat: bestPlace.location.lat, lng: bestPlace.location.lng },
        noiseLevel: bestPlace.noiseLevel,
        updatedAt: bestPlace.updatedAt,
        distance: parseFloat(dist)
      }
    });
  } catch (err) {
    console.log('❌ Magic-wand error:', err.message);
    res.status(500).json({ success: false, message: 'حدث خطأ في تحليل البيانات الجغرافية.' });
  }
});

// ==========================================
// POST /api/send-notification
// ==========================================
app.post('/api/send-notification', async (req, res) => {
  try {
    const { title, body, data, targetSocketId } = req.body;
    if (targetSocketId && registeredPushTokens.has(targetSocketId)) {
      const token = registeredPushTokens.get(targetSocketId);
      await sendPushNotification(token, title, body, data || {});
      return res.json({ success: true, message: 'تم الإرسال' });
    }
    const sentCount = await broadcastNotification(title, body, data || {});
    res.json({ success: true, message: `تم الإرسال إلى ${sentCount} جهاز` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// POST /api/places
// ==========================================
app.post('/api/places', async (req, res) => {
  try {
    const { location, noiseLevel, noiseType, deviceName } = req.body;
    const newPlace = new Place({
      name: deviceName,
      location,
      noiseLevel,
      noiseType,
      updatedAt: new Date()
    });
    await newPlace.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// GET /api/ping
// ==========================================
app.get('/api/ping', (req, res) => {
  res.json({ success: true, serverTime: new Date().toISOString() });
});

// ==========================================
// POST /api/test-notification
// ==========================================
app.post('/api/test-notification', async (req, res) => {
  const { pushToken } = req.body;
  if (!pushToken) return res.status(400).json({ error: 'pushToken مطلوب' });
  const success = await sendPushNotification(pushToken, '🧪 اختبار', 'يجب أن يظهر هذا الإشعار فوراً!', { test: true });
  res.json({ success });
});

