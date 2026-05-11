require('dotenv').config();   
const express = require('express');  
const admin = require('firebase-admin'); 
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

if (!dbURI) {
  console.error("❌ MONGODB_URI is not defined in environment variables!");
  process.exit(1);
}
   
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
  location: {    
    lat: Number,    
    lng: Number,   
    address: String // أضيفي هذا السطر لكي يتم حفظ العنوان فعلياً   
  },   
  noiseLevel: Number,   
  noiseType: { type: String, default: 'هدوء نسبي' },   
  category: { type: String, default: 'عام' }, // أضيفي هذا ليتوافق مع بيانات السوكيت   
  aiDetectedSource: { type: String, default: '' },   
  isAlert: { type: Boolean, default: false },   
  updatedAt: { type: Date, default: Date.now }   
}));   
  const DeviceSchema = new mongoose.Schema({ 
   pushToken: { type: String, required: true, unique: true },
  deviceName: String,
  lat: { type: Number, default: null },
  lng: { type: Number, default: null },
  lastLocationUpdate: { type: Date, default: null },
  lastActive: { type: Date, default: Date.now }
});  

 
const Device = mongoose.model('Device', DeviceSchema); 
const activeDevices = new Map();   
 
   
// ✅ FIX 3: cooldown بالسيرفر — مرة كل 60 ثانية لكل token   
const lastPushSentTime = new Map();   
const PUSH_COOLDOWN_MS = 60000;   
   
// ==========================================   
// 🔥 Firebase Admin Setup
// ==========================================   
try {
   
    const serviceAccount = require("./firebase-admin-sdk.json"); 

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });

    console.log("✅ Firebase Admin SDK: Connected (Project: " + serviceAccount.project_id + ")");
} catch (error) {
    console.error("❌ Firebase Admin Init Error: تأكد من وجود ملف firebase-admin-sdk.json في نفس المجلد");
    console.error(error.message);
}
// ==========================================   
// 🔔 إرسال Push Notification   
// ==========================================   
async function sendPushNotification(pushToken, title, body, data = {}) {
  return sendMultiplePushNotifications([{ to: pushToken, title, body, data }]);
}

async function sendMultiplePushNotifications(notifications) {
  const messages = [];
  for (const n of notifications) {
    if (!Expo.isExpoPushToken(n.to)) {
      console.log(`❌ توكن غير صالح بصيغته: ${n.to}`);
      await Device.deleteOne({ pushToken: n.to });
      continue;
    }
    messages.push({
      to: n.to,
      sound: 'default',
      title: n.title,
      body: n.body,
      priority: 'high',
      channelId: 'noise_alerts',
      data: { ...n.data, displayInForeground: true }
    });
  }

  if (messages.length === 0) return 0;

  let sentCount = 0;
  const chunks = expo.chunkPushNotifications(messages);
  const tickets = [];
  try {
    for (const chunk of chunks) {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...ticketChunk);
    }
  } catch (error) {
    console.error('❌ فشل كلي في عملية الإرسال:', error);
  }

  for (let i = 0; i < tickets.length; i++) {
    const ticket = tickets[i];
    const token = messages[i].to;
    if (ticket.status === 'ok') {
      sentCount++;
      console.log(`✅ إشعار أُرسل بنجاح إلى: ${token}`);
    } else if (ticket.status === 'error') {
      console.log('❌ خطأ في الإرسال:', ticket.message);
      if (ticket.details && ticket.details.error === 'DeviceNotRegistered') {
        await Device.deleteOne({ pushToken: token });
        console.log(`🗑️ تم حذف التوكن من القاعدة لأنه غير مسجل: ${token}`);
      }
    }
  }
  return sentCount;
}
async function broadcastNotification(title, body, data = {}, excludeToken = null, sourceLat = null, sourceLng = null, radiusKm = 0.3) {

  const now = Date.now();
  const notificationsToSend = [];

  try {
    const devices = await Device.find();
    for (const device of devices) {
      const token = device.pushToken;
      if (token === excludeToken) continue;

      const lastSent = lastPushSentTime.get(token) || 0;
      if (now - lastSent < PUSH_COOLDOWN_MS) continue;
       
      // تصفية بالموقع: إذا عندنا موقع المصدر وموقع الجهاز، نرسل فقط للأجهزة القريبة
      if (sourceLat !== null && sourceLng !== null) {
        if (device.lat === null || device.lng === null) continue; // جهاز بدون موقع لا يوصله الإشعار
        const dist = calculateDistance(sourceLat, sourceLng, device.lat, device.lng);
        if (parseFloat(dist) > radiusKm) continue;
      }
      lastPushSentTime.set(token, now);
      notificationsToSend.push({ to: token, title, body, data });
    }
  } catch (err) {
    console.log('❌ خطأ في جلب التوكنات للارسال الجماعي:', err.message);
  }

  if (notificationsToSend.length > 0) {
    return await sendMultiplePushNotifications(notificationsToSend);
  }
  return 0;
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
    
  // تحقق مما إذا كان الذكاء الاصطناعي متأكد فعلاً من وجود صراخ
  const isAiEmergency = aiSource && (aiSource.includes('إنذار') || aiSource.includes('صراخ'));   
      
  // 1. حالة الطوارئ القصوى: صراخ فعلي مع ديسيبل عالي جداً
  if (noiseLevel > 90 && (avgChange > 20 || isAiEmergency))   
    return { detectedType: 'صراخ / إنذار 🚨', isEmergency: true };   

  // 2. ضجيج مستمر مزعج جداً (مثل الحفلات أو الأشغال)
  if (noiseLevel > 95)   
    return { detectedType: 'ضجيج خطير ⚠️', isEmergency: true };   

  // 3. الضجيج الذي يستحق إرسال إشعار (رفعنا الحد من 75 إلى 85)
  // تم إضافة شرط إضافي (aiSource) لضمان أن الصوت ليس مجرد "نويز" عشوائي
  if (noiseLevel > 85 && aiSource && aiSource !== 'هدوء نسبي 🌿')   
    return { detectedType: aiSource || 'ضجيج مرتفع 🔊', isEmergency: true };   
    
  // أي شيء أقل من ذلك يعتبر هدوء ولن يرسل إشعاراً (isEmergency: false)
  return { detectedType: aiSource || 'هدوء نسبي 🌿', isEmergency: false };   
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
  try {   
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=ar&zoom=18`;   
    const resp = await fetch(url, {    
      headers: { 'User-Agent': 'QuiteZone_App_Final' }
    });   
    const geo = await resp.json();   
    
    if (geo && geo.address) {
      const a = geo.address;
      // الترتيب: اسم المكان (جامعة/مقهى) أو المبنى أو الحي أو الشارع
      const realName = a.amenity || a.building || a.cafe || a.library || a.university || a.historic || a.neighbourhood || a.road;
      const city = a.city || a.town || a.village || "";
      
      return realName ? `${realName}، ${city}` : city;
    }
    return `📍 ${lat.toFixed(3)}, ${lng.toFixed(3)}`;
  } catch (err) {   
    return `📍 ${lat.toFixed(3)}, ${lng.toFixed(3)}`;   
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
      address: item.name || item.location?.address || 'موقع غير مسمى',   
      time: item.updatedAt   
    })));   
  } catch (err) {   
    console.log('❌ فشل إرسال السجل الأولي:', err.message);   
  }   
        
  // استلام بيانات الضجيج من الموبايل وحفظها   
  socket.on('noise-data', async (data) => {   
      const { lat, lng, noiseLevel, category } = data;   
    
      try {   
          const address = await reverseGeocode(lat, lng);   
    
          const newLog = new Place({   
              name: address,   
              location: {   
                  lat,   
                  lng,   
                  address: address 
              },   
              noiseLevel,   
              category: category || 'عام',   
              updatedAt: new Date()   
          });   
    
          await newLog.save();   
          console.log(`✅ تم حفظ سجل جديد في: ${address}`);   
    
          io.emit('new-noise-entry', {   
              lat,   
              lng,   
              noiseLevel,   
              address,   
              time: new Date()   
          });   
    
      } catch (err) {   
          console.log('❌ فشل حفظ السجل:', err.message);   
      }   
  });   

  socket.on('register-device', async (data) => { 
    const { pushToken, deviceName, lat, lng } = data; 

    if (pushToken && Expo.isExpoPushToken(pushToken)) { 
        try {
        const updateFields = { deviceName: deviceName || 'جهاز مجهول', lastActive: new Date() };
        if (lat !== undefined && lng !== undefined) {
          updateFields.lat = parseFloat(lat);
          updateFields.lng = parseFloat(lng);
          updateFields.lastLocationUpdate = new Date();
        }
        await Device.findOneAndUpdate( 
          { pushToken: pushToken },  
          updateFields,
          { upsert: true, new: true } 
        ); 
        console.log(`✅ تم حفظ/تحديث التوكن في القاعدة: ${deviceName}`); 

        activeDevices.set(socket.id, { 
          socketId: socket.id, 
          pushToken, 
          deviceName: deviceName || 'جهاز مجهول',
          lat: updateFields.lat || null,
          lng: updateFields.lng || null
        });
        io.emit('update-device-list', Array.from(activeDevices.values()));

      } catch (err) { 
        console.log('❌ خطأ في حفظ التوكن:', err.message); 
      } 
    } 
  }); 

  // ✅ تم نقل هذا الجزء للداخل ليعمل بشكل صحيح
  socket.on('update-location', async (data) => {
    const { pushToken, lat, lng } = data;
    if (!pushToken || lat === undefined || lng === undefined) return;
    try {
      await Device.findOneAndUpdate(
        { pushToken },
        { lat: parseFloat(lat), lng: parseFloat(lng), lastLocationUpdate: new Date(), lastActive: new Date() }
      );
      const device = activeDevices.get(socket.id);
      if (device) {
        device.lat = parseFloat(lat);
        device.lng = parseFloat(lng);
        activeDevices.set(socket.id, device);
      }
    } catch (err) {
      console.log('❌ خطأ في تحديث الموقع:', err.message);
    }
  });

  socket.on('disconnect', () => {   
    activeDevices.delete(socket.id);   
    console.log(`📴 انقطع الاتصال (ID: ${socket.id})`);   
    io.emit('update-device-list', Array.from(activeDevices.values()));   
  });   
}); // نهاية الـ io.on
   
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
        
    // هنا يتم تحديد ما إذا كان الموقف يتطلب "إنذار" (Emergency) بناءً على الديسيبل والنوع
    const { detectedType, isEmergency } = classifyNoise(noiseLevel, audioFeatures || [], aiSource);   
    const address = await reverseGeocode(location.lat, location.lng);   
    const finalNoiseType = aiSource || detectedType;   
        
    // حفظ السجل دائماً في القاعدة للتوثيق (حتى لو كان هادئاً)
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
        
    // تحديث الخريطة والسجلات لحظياً عبر Socket.io
    const updatedHistory = await Place.find().sort({ updatedAt: -1 }).limit(50);   
    io.emit('update-history', updatedHistory.map(p => ({   
      lat: p.location.lat, lng: p.location.lng,   
      noiseLevel: p.noiseLevel,   
      address: p.name || p.location?.address || 'موقع غير مسمى',  
      time: p.updatedAt   
    })));   
        
    // 🔔 منطق الإشعارات المشروط:
    // لن يدخل هنا إلا إذا كانت isEmergency تساوي true (أي ضجيج مرتفع أو صراخ)
    if (isEmergency && !isMuted) {   
      const title = "🤫 يرجى الهدوء - QuietZone";   
      const body = `رصدنا ضجيجاً بمستوى ${noiseLevel} dB في ${address.split(',')[0]}. لطفاً، حافظ على سكينة المكان 🌿`;   
      const now = Date.now();   
    
      // 1. إرسال لصاحب الجهاز نفسه (تنبيه شخصي) مع منع التكرار (Cooldown)
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
    
      // 2. إرسال للأجهزة القريبة (بث جماعي) - فقط عند الضجيج
      await broadcastNotification(title, body, {    
        type: 'NOISE_ALERT',    
        lat: location.lat,    
        lng: location.lng    
      }, pushToken, location.lat, location.lng, 0.3);    
    
      io.emit('collective-noise-alert', { location, noiseLevel, noiseType: detectedType, address });   
    } else {
      // رسالة اختيارية في الـ console للتأكد من أن السيرفر يعمل لكنه لا يرسل إشعارات
      console.log(`🌿 المنطقة هادئة (${noiseLevel} dB)، لا داعي لإرسال إشعار.`);
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
    // 1. جلب البيانات من الأحدث للأقدم   
    const history = await Place.find().sort({ updatedAt: -1 }).limit(50);   
        
    // 2. تحويل البيانات لشكل يفهمه التطبيق (Mapping)   
    const formattedHistory = history.map(item => ({   
      id: item._id.toString(),   
      noiseLevel: item.noiseLevel || 0,   
      // ✅ التعديل هنا: نأخذ القيم من item المسحوب من القاعدة
      noiseType: item.category || item.noiseType || 'غير مصنف',
      time: item.updatedAt,   
      name: item.name || item.location?.address || 'موقع غير مسمى'   
    }));   
    
    // 3. حساب الملخص (الذي يظهر في الكروت بالأعلى)
    const summaryData = await Place.aggregate([
      {
        $group: {
          _id: null,
          totalRecords: { $sum: 1 },
          avgNoiseLevel: { $avg: "$noiseLevel" },
          maxNoiseLevel: { $max: "$noiseLevel" }
        }
      }
    ]);

    let summary = {
      totalRecords: 0,
      avgNoiseLevel: 0,
      maxNoiseLevel: 0,
      maxNoiseName: ''
    };

    if (summaryData.length > 0) {
      summary.totalRecords = summaryData[0].totalRecords;
      summary.avgNoiseLevel = Math.round(summaryData[0].avgNoiseLevel || 0);
      summary.maxNoiseLevel = summaryData[0].maxNoiseLevel || 0;

      // جلب اسم المكان صاحب أعلى مستوى ضجيج لعرضه في الإحصائيات
      const maxPlace = await Place.findOne({ noiseLevel: summary.maxNoiseLevel }).select('name location');
      summary.maxNoiseName = maxPlace?.name || maxPlace?.location?.address || 'غير محدد';
    }
    
    res.json({   
      success: true,   
      history: formattedHistory, 
      summary
    });   
  } catch (err) {   
    console.error("Stats Error:", err);   
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
// POST /api/magic-wand - خوارزمية أهدأ منطقة (نسخة الأطروحة النهائية)
// ==========================================  
// ==========================================  
// POST /api/magic-wand - خوارزمية أهدأ منطقة (نسخة محسنة)
// ==========================================  
app.post('/api/magic-wand', async (req, res) => {  
  try {  
    const { latitude, longitude, maxDistance } = req.body;  
    // 10 كم كحد افتراضي لضمان ظهور نتائج أثناء التجربة
    const searchRadius = maxDistance ? parseFloat(maxDistance) : 10;  
  
    if (!latitude || !longitude) {  
      return res.json({ success: false, message: 'الموقع الجغرافي غير متوفر.' });  
    }  
  
    const userLat = parseFloat(latitude);  
    const userLng = parseFloat(longitude);  
  
    // 1. جلب المناطق الهادئة (رفعنا الحد لـ 65 ديسيبل ليكون البحث مرناً)
    const quietPlaces = await Place.find({ noiseLevel: { $lte: 65 } });  
  
    if (quietPlaces.length === 0) {  
      return res.json({ success: false, message: 'لا توجد تسجيلات لهدوء في قاعدة البيانات حالياً.' });  
    }  
  
    // 2. فلترة الأماكن القريبة وحساب المسافة بدقة
    const nearbyPlaces = quietPlaces.map(place => {
      const d = calculateDistance(userLat, userLng, place.location.lat, place.location.lng);
      return { ...place._doc, distance: parseFloat(d) };
    }).filter(p => p.distance <= searchRadius);
  
    if (nearbyPlaces.length === 0) {  
      return res.json({ success: false, message: `لا يوجد هدوء مرصود ضمن نطاق ${searchRadius} كم.` });  
    }  
  
    // 3. اختيار الأهدأ (الأقل ديسيبل) من بين القريبين
    const bestPlace = nearbyPlaces.sort((a, b) => a.noiseLevel - b.noiseLevel)[0];  

    // 4. جلب الاسم الحقيقي وتحسينه
    let realName = await reverseGeocode(bestPlace.location.lat, bestPlace.location.lng);
    let finalAreaName = "منطقة هادئة";
    
    if (realName && !realName.includes("📍")) {
        let parts = realName.split(/[،,]/).map(p => p.trim());
        // نختار أول جزء نصي يعبر عن اسم المكان
        finalAreaName = parts.find(p => isNaN(p.charAt(0)) && p.length > 3) || parts[0];
    }

    // 5. التنسيق الزمني
    const timeFormatted = new Date(bestPlace.updatedAt).toLocaleTimeString('ar-SY', { 
        hour: '2-digit', 
        minute: '2-digit' 
    });

    res.json({   
      success: true,   
      message: `وجدتها! أهدأ منطقة هي ${finalAreaName}`,   
      bestRoute: {  
        name: finalAreaName, 
        noiseLevel: bestPlace.noiseLevel,
        distance: bestPlace.distance.toFixed(2),
        observedIn: `رصد في: ${new Date(bestPlace.updatedAt).toLocaleDateString('ar-SY')}`,
        time: `الساعة: ${timeFormatted}`,
        location: { lat: bestPlace.location.lat, lng: bestPlace.location.lng }
      }   
    });  
  
  } catch (err) {  
    res.status(500).json({ success: false, message: 'حدث خطأ في الخوارزمية.' });  
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
