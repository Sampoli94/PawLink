import React, { useState, useEffect, useRef } from 'react';
import { 
  MapPin, AlertTriangle, MessageSquare, Award, User, Shield, 
  CheckCircle, PlusCircle, Navigation, Info, Send, Phone, 
  Lock, Eye, Search, Filter, ShieldAlert, Heart, Calendar, LogOut, Loader
} from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const API_BASE = 'http://localhost:5000/api';

// Predefined mock photos for easy selection in local/mock testing
const MOCK_ANIMAL_PHOTOS = [
  { name: 'Cane meticcio marrone', url: 'https://images.unsplash.com/photo-1543466835-00a7907e9de1?auto=format&fit=crop&q=80&w=400' },
  { name: 'Gatto soriano grigio', url: 'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?auto=format&fit=crop&q=80&w=400' },
  { name: 'Cagnolino ferito (sangue)', url: 'https://images.unsplash.com/photo-1583511655857-d19b40a7a54e?auto=format&fit=crop&q=80&w=400' },
  { name: 'Gatto smarrito bianco', url: 'https://images.unsplash.com/photo-1533738363-b7f9aef128ce?auto=format&fit=crop&q=80&w=400' }
];

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('pwl_token') || '');
  const [user, setUser] = useState(null);
  const [currentTab, setCurrentTab] = useState('mappa');
  const [isServerOnline, setIsServerOnline] = useState(false);
  const [loading, setLoading] = useState(true);

  // Auth Form State
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('cittadino'); // 'cittadino' | 'volontario' | 'veterinario' | 'rifugio'
  const [authError, setAuthError] = useState('');

  // Main Database State (Local Emulation database if server is offline)
  const [reports, setReports] = useState([]);
  const [chats, setChats] = useState([]);
  const [rewards, setRewards] = useState([]);
  const [overlays, setOverlays] = useState({ vets: [], stores: [], hotspots: [] });
  const [selectedChat, setSelectedChat] = useState(null);
  const [activeChatMessages, setActiveChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');

  // Dialog State
  const [showReportModal, setShowReportModal] = useState(false);
  const [newReportType, setNewReportType] = useState('cane');
  const [newReportDesc, setNewReportDesc] = useState('');
  const [newReportLat, setNewReportLat] = useState(38.4250);
  const [newReportLng, setNewReportLng] = useState(15.9010);
  const [selectedPhotoUrl, setSelectedPhotoUrl] = useState(MOCK_ANIMAL_PHOTOS[0].url);
  const [isReportSubmitting, setIsReportSubmitting] = useState(false);

  // IA Diagnostica State
  const [iaSpecies, setIaSpecies] = useState('cane');
  const [iaSymptoms, setIaSymptoms] = useState([]);
  const [iaDiagnosis, setIaDiagnosis] = useState(null);

  // Gamification Redemptions
  const [redeemedCoupon, setRedeemedCoupon] = useState(null);

  // Filters for reports list
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');

  // Guest Mode Auth Modal state
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  // Real Map States and Refs
  const [mapCenter, setMapCenter] = useState([38.4250, 15.9010]); // Default to Gioia Tauro
  const [mapZoom, setMapZoom] = useState(13);
  const [userCoords, setUserCoords] = useState(null);
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersLayerRef = useRef(null);
  const userRef = useRef(user);

  // Keep userRef updated to prevent closure stale state in Leaflet click handler
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  // Test Server Connection & Load Initial Data
  useEffect(() => {
    checkServerConnection();
  }, [token]);

  const checkServerConnection = async () => {
    setLoading(true);
    try {
      // Try to check profile
      const response = await fetch(`${API_BASE}/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const userData = await response.json();
        setUser(userData);
        setIsServerOnline(true);
        loadServerData();
      } else {
        // Token invalid/expired
        if (token) {
          handleLogout();
        } else {
          setIsServerOnline(true);
          loadServerData();
        }
      }
    } catch (err) {
      // Server offline - fallback to local emulation
      setIsServerOnline(false);
      loadLocalEmulatedData();
    } finally {
      setLoading(false);
    }
  };

  // 1. Geolocation Hook - runs on mount
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setUserCoords(coords);
          setMapCenter([coords.lat, coords.lng]);
          
          // Set default coordinates for new reports
          setNewReportLat(coords.lat.toFixed(4));
          setNewReportLng(coords.lng.toFixed(4));
        },
        (err) => {
          console.log("Geolocalizzazione rifiutata o non disponibile, uso default");
        }
      );
    }
  }, []);

  // 2. Leaflet Map Initialization Hook
  useEffect(() => {
    if (currentTab === 'mappa' && mapRef.current && !mapInstanceRef.current) {
      // Initialize map instance without default zoom control
      const map = L.map(mapRef.current, { zoomControl: false }).setView(mapCenter, mapZoom);
      mapInstanceRef.current = map;

      // Add zoom control on the top-right
      L.control.zoom({ position: 'topright' }).addTo(map);

      // Dark Mode tile layer (CartoDB Dark Matter)
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20
      }).addTo(map);

      // Create a layer group for active markers
      markersLayerRef.current = L.layerGroup().addTo(map);

      // Listen for map clicks to create a new report
      map.on('click', (e) => {
        if (!userRef.current) {
          setAuthMode('register');
          setIsAuthModalOpen(true);
          return;
        }
        setNewReportLat(e.latlng.lat.toFixed(4));
        setNewReportLng(e.latlng.lng.toFixed(4));
        setShowReportModal(true);
      });
    }

    // Clean up map instance on tab change / unmount
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [currentTab, loading]);

  // 3. Leaflet Markers Update Hook
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const markersLayer = markersLayerRef.current;
    if (!markersLayer) return;

    // Clear old markers
    markersLayer.clearLayers();

    // Add pulsing user marker if coordinates are available
    if (userCoords) {
      const userMarker = L.marker([userCoords.lat, userCoords.lng], {
        icon: L.divIcon({
          className: 'user-location-marker',
          html: `<div style="position: relative;">
            <div style="width: 14px; height: 14px; background-color: #3b82f6; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 8px #3b82f6;"></div>
            <div style="position: absolute; top: -5px; left: -5px; width: 24px; height: 24px; background-color: rgba(59, 130, 246, 0.3); border-radius: 50%; animation: pulse-hotspot 2s infinite;"></div>
          </div>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        })
      });
      userMarker.bindPopup("<b>La tua posizione attuale</b>").addTo(markersLayer);
    }

    // Add Vets
    overlays.vets?.forEach(v => {
      const vetMarker = L.marker([v.lat, v.lng], {
        icon: L.divIcon({
          className: 'vet-marker',
          html: `<div style="background-color: #6366f1; width: 18px; height: 18px; border-radius: 50%; border: 2px solid white; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 8px #6366f1;">
            <span style="color: white; font-size: 10px; font-weight: bold; margin-top: -1px;">+</span>
          </div>`,
          iconSize: [18, 18],
          iconAnchor: [9, 9]
        })
      });
      const popupHtml = `
        <div style="color: #1e293b; font-family: sans-serif; font-size: 12px; width: 180px; padding: 2px;">
          <h4 style="margin: 0 0 4px; font-size: 13px; color: #0f172a; font-weight: bold;">${v.name}</h4>
          <p style="margin: 0 0 6px; color: #64748b; font-size: 11px;">${v.address}</p>
          <a href="tel:${v.phone}" style="color: #6366f1; font-weight: bold; text-decoration: none; display: flex; align-items: center; gap: 4px;">
            📞 ${v.phone}
          </a>
          ${v.emergency24h ? '<span style="display: inline-block; background-color: #f43f5e; color: white; font-size: 8px; font-weight: bold; padding: 1px 4px; border-radius: 3px; margin-top: 5px;">H24 PRONTO SOCCORSO</span>' : ''}
        </div>
      `;
      vetMarker.bindPopup(popupHtml).addTo(markersLayer);
    });

    // Add Stores
    overlays.stores?.forEach(s => {
      const storeMarker = L.marker([s.lat, s.lng], {
        icon: L.divIcon({
          className: 'store-marker',
          html: `<div style="background-color: #eab308; width: 14px; height: 14px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 6px #eab308;"></div>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7]
        })
      });
      const popupHtml = `
        <div style="color: #1e293b; font-family: sans-serif; font-size: 12px; padding: 2px;">
          <h4 style="margin: 0 0 4px; font-size: 13px; color: #0f172a; font-weight: bold;">${s.name}</h4>
          <p style="margin: 0; color: #64748b; font-size: 11px;">${s.address}</p>
        </div>
      `;
      storeMarker.bindPopup(popupHtml).addTo(markersLayer);
    });

    // Add Active Reports
    reports.filter(r => r.status !== 'risolto').forEach(r => {
      const color = r.status === 'in_carico' ? '#f59e0b' : '#10b981';
      const reportMarker = L.marker([r.latitude, r.longitude], {
        icon: L.divIcon({
          className: 'report-marker',
          html: `<div style="background-color: ${color}; width: 16px; height: 16px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 10px ${color}; animation: pulse-hotspot 2s infinite;"></div>`,
          iconSize: [16, 16],
          iconAnchor: [8, 8]
        })
      });
      const popupHtml = `
        <div style="color: #1e293b; font-family: sans-serif; font-size: 12px; width: 180px; padding: 2px;">
          <span style="display: inline-block; background-color: ${color}; color: white; font-size: 8px; font-weight: bold; padding: 1px 4px; border-radius: 3px; margin-bottom: 4px; text-transform: uppercase;">
            ${r.animalType} - ${r.status}
          </span>
          <p style="margin: 0 0 6px; font-size: 11px; line-height: 1.3; color: #334155;">${r.description}</p>
          <div style="font-size: 9px; color: #64748b; border-top: 1px solid #f1f5f9; padding-top: 4px; margin-top: 4px;">Segnalato da: <b>${r.reporterName}</b></div>
        </div>
      `;
      reportMarker.bindPopup(popupHtml).addTo(markersLayer);
    });

    // Add Hotspots (draw circles around randagism clusters)
    overlays.hotspots?.forEach(h => {
      L.circle([h.lat, h.lng], {
        color: '#f43f5e',
        fillColor: '#f43f5e',
        fillOpacity: 0.15,
        radius: 300 // 300m radius
      }).addTo(markersLayer);
    });

  }, [reports, overlays, userCoords, currentTab, loading]);

  // Load Data from Express Backend
  const loadServerData = async () => {
    try {
      const repRes = await fetch(`${API_BASE}/reports`);
      const repData = await repRes.json();
      setReports(Array.isArray(repData) ? repData : []);

      const mapRes = await fetch(`${API_BASE}/map/overlays`);
      const mapData = await mapRes.json();
      setOverlays(mapData && typeof mapData === 'object' ? mapData : { vets: [], stores: [], hotspots: [] });

      const rewRes = await fetch(`${API_BASE}/rewards`);
      const rewData = await rewRes.json();
      setRewards(Array.isArray(rewData) ? rewData : []);

      if (token) {
        const chatRes = await fetch(`${API_BASE}/chats`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const chatData = await chatRes.json();
        setChats(Array.isArray(chatData) ? chatData : []);
      }
    } catch (err) {
      console.error("Errore nel caricamento dati server:", err);
    }
  };

  // Emulation fallback when server is not running
  const loadLocalEmulatedData = () => {
    // Check localStorage for emulated DB
    let localDb = localStorage.getItem('pawlink_db');
    if (!localDb) {
      const initialDb = {
        users: [],
        reports: [
          {
            id: 'rep-1',
            reporterId: 'usr-demo1',
            reporterName: 'Maria N.',
            animalType: 'cane',
            description: 'Trovato cane smarrito vicino alla villa comunale. Sembra ferito alla zampa posteriore e perde un po di sangue.',
            latitude: 38.4230,
            longitude: 15.9030,
            photoUrl: MOCK_ANIMAL_PHOTOS[2].url, // dog with injury keyword matching 'sangue'
            status: 'segnalato',
            volunteerId: null,
            volunteerName: null,
            sensitive: true,
            comments: [],
            createdAt: new Date(Date.now() - 3600000).toISOString(),
            lastUpdatedAt: new Date(Date.now() - 3600000).toISOString()
          },
          {
            id: 'rep-2',
            reporterId: 'usr-demo2',
            reporterName: 'Giovanni R.',
            animalType: 'gatto',
            description: 'Gattino grigio molto affettuoso si aggira nei pressi del supermercato Conad. Cerca cibo.',
            latitude: 38.4310,
            longitude: 15.8990,
            photoUrl: MOCK_ANIMAL_PHOTOS[1].url,
            status: 'in_carico',
            volunteerId: 'usr-volunteer',
            volunteerName: 'Marco Rossano (Volontario)',
            sensitive: false,
            comments: [],
            createdAt: new Date(Date.now() - 7200000).toISOString(),
            lastUpdatedAt: new Date(Date.now() - 3600000).toISOString()
          }
        ],
        chats: [
          {
            id: 'chat-general',
            reportId: null,
            animalType: 'community',
            name: 'Canale di Coordinamento Nazionale',
            members: ['usr-demo1', 'usr-demo2', 'usr-volunteer'],
            messages: [
              { senderId: 'usr-demo1', senderName: 'Maria N.', text: 'Ciao a tutti! Qualcuno è in zona per dare una mano con una segnalazione?', timestamp: new Date(Date.now() - 4000000).toISOString() },
              { senderId: 'usr-volunteer', senderName: 'Marco Rossano (Volontario)', text: 'Io dovrei passare da quelle parti tra mezzora, posso controllare.', timestamp: new Date(Date.now() - 3500000).toISOString() }
            ]
          }
        ],
        rewards: [
          { id: 'rew-1', title: 'Sconto 10% cibo cani/gatti', points: 100, partner: 'PetStore Convenzionato' },
          { id: 'rew-2', title: 'Visita controllo gratuita', points: 300, partner: 'Clinica Vet Croce Azzurra' },
          { id: 'rew-3', title: 'Antiparassitario in omaggio', points: 150, partner: 'Farmacia degli Animali' }
        ],
        vets: [
          { id: 'vet-1', name: 'Dr. Rossi - Clinica Vet Croce Azzurra', lat: 38.4285, lng: 15.9012, address: 'Via Roma 10', phone: '02 12345678', emergency24h: true, verified: true },
          { id: 'vet-2', name: 'Dr.ssa Bianchi - Studio Veterinario', lat: 38.4190, lng: 15.8950, address: 'Via Garibaldi 45', phone: '02 78901234', emergency24h: false, verified: true }
        ],
        stores: [
          { id: 'store-1', name: 'PetStore - Cibo & Accessori', lat: 38.4250, lng: 15.9050, address: 'Via Nazionale 12', phone: '02 54321098' },
          { id: 'store-2', name: 'Supermercato Conad - Reparto Animali', lat: 38.4310, lng: 15.8990, address: 'Corso Umberto 80', phone: '02 99988877' }
        ],
        hotspots: [
          { id: 'hs-1', lat: 38.4230, lng: 15.9030, count: 3 }
        ]
      };
      localStorage.setItem('pawlink_db', JSON.stringify(initialDb));
      localDb = JSON.stringify(initialDb);
    }

    const db = JSON.parse(localDb);
    setReports(db.reports || []);
    setRewards(db.rewards || []);
    setOverlays({ 
      vets: db.vets || [], 
      stores: db.stores || [], 
      hotspots: db.hotspots || [] 
    });

    // Emulated Session Check
    const emulatedUser = localStorage.getItem('pwl_emulated_user');
    if (emulatedUser) {
      setUser(JSON.parse(emulatedUser));
      // filter chats for this user
      const currentUser = JSON.parse(emulatedUser);
      const userChats = (db.chats || []).filter(c => c.members.includes(currentUser.id) || c.id === 'chat-general');
      setChats(userChats);
    }
  };

  const saveEmulatedDb = (newDb) => {
    localStorage.setItem('pawlink_db', JSON.stringify(newDb));
  };

  // --- ACTIONS ---

  // Auth Operations
  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError('');
    
    if (isServerOnline) {
      const url = authMode === 'login' ? `${API_BASE}/auth/login` : `${API_BASE}/auth/register`;
      const body = authMode === 'login' 
        ? { email, password } 
        : { email, password, name, role, phone };

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await res.json();
        if (res.ok) {
          localStorage.setItem('pwl_token', data.token);
          setToken(data.token);
          setUser(data.user);
          loadServerData();
          setIsAuthModalOpen(false); // Success - close modal
        } else {
          setAuthError(data.message || 'Errore autenticazione');
        }
      } catch (err) {
        setAuthError('Errore di rete con il server');
      }
    } else {
      // EMULATION MODE AUTH
      const db = JSON.parse(localStorage.getItem('pawlink_db'));
      if (authMode === 'login') {
        const found = db.users?.find(u => u.email.toLowerCase() === email.toLowerCase());
        if (found) {
          const userSession = { id: found.id, name: found.name, email: found.email, role: found.role, points: found.points || 0, phone: found.phone };
          setUser(userSession);
          localStorage.setItem('pwl_emulated_user', JSON.stringify(userSession));
          const userChats = db.chats.filter(c => c.members.includes(found.id) || c.id === 'chat-general');
          setChats(userChats);
          setIsAuthModalOpen(false); // Success - close modal
        } else {
          // If no users found, let's create a default sandbox user instantly
          const userSession = { id: 'usr-vol', name: 'Marco (Demo Volontario)', email: email, role: 'volontario', points: 150, phone: '333 1234567' };
          setUser(userSession);
          localStorage.setItem('pwl_emulated_user', JSON.stringify(userSession));
          
          db.users = db.users || [];
          db.users.push(userSession);
          saveEmulatedDb(db);
          
          const userChats = db.chats.filter(c => c.members.includes(userSession.id) || c.id === 'chat-general');
          setChats(userChats);
          setIsAuthModalOpen(false); // Success - close modal
        }
      } else {
        const newUser = {
          id: 'usr-' + Date.now(),
          email,
          name,
          role,
          phone,
          points: 0
        };
        db.users = db.users || [];
        db.users.push(newUser);
        saveEmulatedDb(db);

        setUser(newUser);
        localStorage.setItem('pwl_emulated_user', JSON.stringify(newUser));
        setChats(db.chats.filter(c => c.members.includes(newUser.id) || c.id === 'chat-general'));
        setIsAuthModalOpen(false); // Success - close modal
      }
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('pwl_token');
    localStorage.removeItem('pwl_emulated_user');
    setToken('');
    setUser(null);
    setChats([]);
    setSelectedChat(null);
  };

  // Submit Report
  const handleCreateReport = async (e) => {
    e.preventDefault();
    if (!newReportDesc.trim()) return;
    setIsReportSubmitting(true);

    const checkMod = (desc) => {
      const keywordsGrave = ['sangue', 'ferita', 'investito', 'ferito', 'grave', 'muore', 'violenza', 'maltrattamento', 'maltrattato'];
      const textLower = desc.toLowerCase();
      const isSensitive = keywordsGrave.some(k => textLower.includes(k));
      const containsObscene = ['nudo', 'cazzo', 'figa', 'porno'].some(k => textLower.includes(k));
      return { isSensitive, containsObscene };
    };

    const mod = checkMod(newReportDesc);
    if (mod.containsObscene) {
      alert("La descrizione contiene termini non appropriati e non può essere pubblicata.");
      setIsReportSubmitting(false);
      return;
    }

    if (isServerOnline) {
      try {
        const res = await fetch(`${API_BASE}/reports`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            animalType: newReportType,
            description: newReportDesc,
            latitude: newReportLat,
            longitude: newReportLng,
            photo: selectedPhotoUrl // using mock url
          })
        });
        if (res.ok) {
          loadServerData();
          setShowReportModal(false);
          setNewReportDesc('');
        } else {
          const errData = await res.json();
          alert(errData.message || "Errore nella creazione della segnalazione");
        }
      } catch (err) {
        alert("Errore di connessione");
      }
    } else {
      // EMULATION MODE
      const db = JSON.parse(localStorage.getItem('pawlink_db'));
      const newRep = {
        id: 'rep-' + Date.now(),
        reporterId: user.id,
        reporterName: user.name,
        animalType: newReportType,
        description: newReportDesc,
        latitude: parseFloat(newReportLat),
        longitude: parseFloat(newReportLng),
        photoUrl: selectedPhotoUrl,
        status: 'segnalato',
        volunteerId: null,
        volunteerName: null,
        sensitive: mod.isSensitive,
        comments: [],
        createdAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString()
      };

      db.reports.push(newRep);
      
      // Update hotspots emulating server recalculation
      db.hotspots = db.hotspots || [];
      db.hotspots.push({ id: 'hs-' + newRep.id, lat: newRep.latitude, lng: newRep.longitude, count: 2 });

      saveEmulatedDb(db);
      setReports(db.reports);
      setOverlays(prev => ({ ...prev, hotspots: db.hotspots }));
      setShowReportModal(false);
      setNewReportDesc('');
    }
    setIsReportSubmitting(false);
  };

  // Take Charge
  const handleTakeCharge = async (reportId) => {
    if (!user) {
      setAuthMode('login');
      setIsAuthModalOpen(true);
      return;
    }
    if (isServerOnline) {
      try {
        const res = await fetch(`${API_BASE}/reports/${reportId}/take-charge`, {
          method: 'PATCH',
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          loadServerData();
        }
      } catch (err) {
        console.error(err);
      }
    } else {
      // EMULATION MODE
      const db = JSON.parse(localStorage.getItem('pawlink_db'));
      const report = db.reports.find(r => r.id === reportId);
      if (report && report.status === 'segnalato') {
        report.status = 'in_carico';
        report.volunteerId = user.id;
        report.volunteerName = `${user.name} (Volontario)`;
        report.lastUpdatedAt = new Date().toISOString();

        // Create emulated Chat
        const newChat = {
          id: 'chat-rep-' + report.id,
          reportId: report.id,
          name: `Coordinamento: ${report.animalType.toUpperCase()} - ${report.reporterName}`,
          animalType: report.animalType,
          members: [report.reporterId, user.id],
          messages: [
            {
              senderId: 'system',
              senderName: 'Sistema PawLink',
              text: `Il volontario ${user.name} ha preso in carico la segnalazione. Coordinatevi qui per il recupero!`,
              timestamp: new Date().toISOString()
            }
          ]
        };
        db.chats.push(newChat);
        saveEmulatedDb(db);
        setReports(db.reports);
        setChats(db.chats.filter(c => c.members.includes(user.id) || c.id === 'chat-general'));
      }
    }
  };

  // Resolve
  const handleResolveReport = async (reportId) => {
    if (isServerOnline) {
      try {
        const res = await fetch(`${API_BASE}/reports/${reportId}/resolve`, {
          method: 'PATCH',
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          loadServerData();
          // reload points
          const meRes = await fetch(`${API_BASE}/auth/me`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          const meData = await meRes.json();
          setUser(prev => ({ ...prev, points: meData.points }));
        }
      } catch (err) {
        console.error(err);
      }
    } else {
      // EMULATION MODE
      const db = JSON.parse(localStorage.getItem('pawlink_db'));
      const report = db.reports.find(r => r.id === reportId);
      if (report && report.status === 'in_carico') {
        report.status = 'risolto';
        report.lastUpdatedAt = new Date().toISOString();

        // Add points
        const updatedUser = { ...user, points: (user.points || 0) + 50 };
        setUser(updatedUser);
        localStorage.setItem('pwl_emulated_user', JSON.stringify(updatedUser));

        // Update in db
        const dbUser = db.users?.find(u => u.id === user.id);
        if (dbUser) dbUser.points = updatedUser.points;

        saveEmulatedDb(db);
        setReports(db.reports);
      }
    }
  };

  // Chat messages management
  const handleOpenChat = async (chat) => {
    setSelectedChat(chat);
    if (isServerOnline) {
      try {
        const res = await fetch(`${API_BASE}/chats/${chat.id}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        setActiveChatMessages(data.messages || []);
      } catch (err) {
        console.error(err);
      }
    } else {
      setActiveChatMessages(chat.messages || []);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!chatInput.trim() || !selectedChat) return;

    const textToSend = chatInput;
    setChatInput('');

    if (isServerOnline) {
      try {
        const res = await fetch(`${API_BASE}/chats/${selectedChat.id}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ text: textToSend })
        });
        if (res.ok) {
          const newMsg = await res.json();
          setActiveChatMessages(prev => [...prev, newMsg]);
          loadServerData();
        }
      } catch (err) {
        console.error(err);
      }
    } else {
      // EMULATION MODE
      const db = JSON.parse(localStorage.getItem('pawlink_db'));
      const chat = db.chats.find(c => c.id === selectedChat.id);
      if (chat) {
        const newMsg = {
          senderId: user.id,
          senderName: user.name,
          text: textToSend,
          timestamp: new Date().toISOString()
        };
        chat.messages.push(newMsg);
        saveEmulatedDb(db);
        setActiveChatMessages([...chat.messages]);
        // Update local chats list
        setChats(db.chats.filter(c => c.members.includes(user.id) || c.id === 'chat-general'));
      }
    }
  };

  // Redeem Reward
  const handleRedeemReward = async (rewardId) => {
    if (!user) {
      setAuthMode('login');
      setIsAuthModalOpen(true);
      return;
    }
    if (isServerOnline) {
      try {
        const res = await fetch(`${API_BASE}/rewards/${rewardId}/redeem`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (res.ok) {
          setRedeemedCoupon(data.message);
          setUser(prev => ({ ...prev, points: data.userPoints }));
        } else {
          alert(data.message);
        }
      } catch (err) {
        console.error(err);
      }
    } else {
      // EMULATION
      const db = JSON.parse(localStorage.getItem('pawlink_db'));
      const reward = db.rewards.find(r => r.id === rewardId);
      if (reward && user.points >= reward.points) {
        const updatedPoints = user.points - reward.points;
        const updatedUser = { ...user, points: updatedPoints };
        setUser(updatedUser);
        localStorage.setItem('pwl_emulated_user', JSON.stringify(updatedUser));

        const dbUser = db.users?.find(u => u.id === user.id);
        if (dbUser) dbUser.points = updatedPoints;
        saveEmulatedDb(db);

        setRedeemedCoupon(`Premio riscattato con successo! Codice Coupon emulato: PWL-EMU-${Math.random().toString(36).substr(2, 9).toUpperCase()}`);
      } else {
        alert("Punti insufficienti!");
      }
    }
  };

  // IA Diagnostica
  const handleDiagnose = (e) => {
    e.preventDefault();
    if (iaSymptoms.length === 0) return;

    let level = 'VERDE';
    let label = 'Situazione Gestibile';
    let desc = 'I sintomi descritti sembrano lievi. Consigliamo di monitorare l\'animale, tenerlo idratato e in un ambiente caldo. Se i sintomi persistono per più di 24 ore, contatta il veterinario.';
    let icon = 'green';

    // If symptoms contain critical ones (sangue, respirazione, letargia grave)
    const hasCritical = iaSymptoms.some(s => ['respirazione', 'sangue', 'incosciente', 'convulsioni'].includes(s));
    const hasMedium = iaSymptoms.some(s => ['vomito', 'diarrea', 'letargia', 'zoppia'].includes(s));

    if (hasCritical) {
      level = 'ROSSO';
      label = 'Emergenza Critica';
      desc = 'ATTENZIONE: I sintomi indicano una situazione potenzialmente molto grave o letale. Richiede l\'intervento urgente di un veterinario o di una clinica h24 immediatamente!';
    } else if (hasMedium) {
      level = 'GIALLO';
      label = 'Consulto Consigliato';
      desc = 'I sintomi necessitano di attenzione medica a breve. Consigliamo di pianificare una visita dal veterinario entro la giornata per evitare peggioramenti.';
    }

    setIaDiagnosis({
      level,
      label,
      description: desc,
      recommendations: [
        'Non somministrare farmaci umani (es. Tachipirina) che sono tossici per gli animali.',
        'Assicurati che l\'animale sia al sicuro e non possa fuggire o farsi ulteriore male.',
        'Prendi nota dell\'orario di comparsa dei sintomi per riferirlo al medico.'
      ]
    });
  };

  const toggleSymptom = (symptom) => {
    if (iaSymptoms.includes(symptom)) {
      setIaSymptoms(iaSymptoms.filter(s => s !== symptom));
    } else {
      setIaSymptoms([...iaSymptoms, symptom]);
    }
  };

  // Click on Custom Town Map to position Marker
  const handleMapClick = (lat, lng) => {
    if (!user) {
      setAuthMode('register');
      setIsAuthModalOpen(true);
      return;
    }
    setNewReportLat(lat.toFixed(4));
    setNewReportLng(lng.toFixed(4));
    setShowReportModal(true);
  };

  // Filters for reports list
  const filteredReports = reports.filter(r => {
    const matchesType = filterType === 'all' || r.animalType === filterType;
    const matchesStatus = filterStatus === 'all' || r.status === filterStatus;
    return matchesType && matchesStatus;
  });

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#0b0f19] text-gray-200">
        <Loader className="w-12 h-12 text-[#10b981] animate-spin mb-4" />
        <p className="font-display text-lg">Caricamento PawLink in corso...</p>
      </div>
    );
  }

  // --- RENDERING APPLICATION WORKSPACE ---
  return (
    <div className="min-h-screen flex flex-col">
      {/* HEADER */}
      <header className="glass-header px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#10b981] to-[#059669] flex items-center justify-center">
            <Heart className="w-5 h-5 text-white fill-white" />
          </div>
          <div className="flex flex-col">
            <h1 className="text-xl font-bold tracking-tight text-white font-display leading-none">PawLink</h1>
            <div className="flex items-center gap-1.5 mt-1">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isServerOnline ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'}`}></span>
              <span className="text-[9px] text-gray-400 uppercase tracking-wider font-bold whitespace-nowrap">
                {isServerOnline ? 'Server Attivo' : 'Demo Locale'}
              </span>
            </div>
          </div>
        </div>

        {/* Desktop Tabs Navigation - Ultra Premium style */}
        <nav className="hidden lg:flex items-center gap-1 bg-gray-950/60 p-1.5 rounded-xl border border-white/5 shadow-inner">
          <button 
            onClick={() => setCurrentTab('mappa')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 ${currentTab === 'mappa' ? 'bg-[#10b981] text-white shadow-lg shadow-[#10b981]/20' : 'text-gray-400 hover:text-gray-200 bg-transparent border-0 cursor-pointer'}`}
          >
            <MapPin className="w-4 h-4" /> Mappa
          </button>
          <button 
            onClick={() => setCurrentTab('segnalazioni')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 ${currentTab === 'segnalazioni' ? 'bg-[#10b981] text-white shadow-lg shadow-[#10b981]/20' : 'text-gray-400 hover:text-gray-200 bg-transparent border-0 cursor-pointer'}`}
          >
            <AlertTriangle className="w-4 h-4" /> 
            <span>Segnalazioni</span>
            <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 text-[10px] font-bold">
              {reports.filter(r => r.status === 'segnalato').length}
            </span>
          </button>
          <button 
            onClick={() => setCurrentTab('chat')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 ${currentTab === 'chat' ? 'bg-[#10b981] text-white shadow-lg shadow-[#10b981]/20' : 'text-gray-400 hover:text-gray-200 bg-transparent border-0 cursor-pointer'}`}
          >
            <MessageSquare className="w-4 h-4" /> Chat
          </button>
          <button 
            onClick={() => setCurrentTab('premi')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 ${currentTab === 'premi' ? 'bg-[#10b981] text-white shadow-lg shadow-[#10b981]/20' : 'text-gray-400 hover:text-gray-200 bg-transparent border-0 cursor-pointer'}`}
          >
            <Award className="w-4 h-4" /> Premi
          </button>
          <button 
            onClick={() => setCurrentTab('triage')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 ${currentTab === 'triage' ? 'bg-[#10b981] text-white shadow-lg shadow-[#10b981]/20' : 'text-gray-400 hover:text-gray-200 bg-transparent border-0 cursor-pointer'}`}
          >
            <ShieldAlert className="w-4 h-4 text-purple-400" /> Triage IA
          </button>
        </nav>

        {/* User profile & Actions */}
        <div className="flex items-center gap-4 shrink-0">
          {user ? (
            <>
              <div className="glass-panel px-4 py-1.5 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-emerald-950 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold text-sm">
                  {user.name[0]}
                </div>
                <div className="text-left">
                  <div className="text-xs font-semibold flex items-center gap-1">
                    {user.name}
                    {user.role === 'volontario' && <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 text-[9px] border border-emerald-500/20 font-bold uppercase">Volontario</span>}
                  </div>
                  <div className="text-[10px] text-gray-400 font-semibold flex items-center gap-1">
                    <Award className="w-3 h-3 text-amber-500 fill-amber-500" />
                    {user.points || 0} Punti Accumulati
                  </div>
                </div>
              </div>
              <button onClick={handleLogout} className="p-2.5 rounded-lg bg-gray-900 border border-gray-800 text-gray-400 hover:text-red-400 transition-colors">
                <LogOut className="w-4 h-4" />
              </button>
            </>
          ) : (
            <button 
              onClick={() => {
                setAuthMode('login');
                setIsAuthModalOpen(true);
              }}
              className="btn-primary text-xs py-2 px-4 bg-gradient-to-tr from-[#10b981] to-[#059669]"
            >
              Accedi / Registrati
            </button>
          )}
        </div>
      </header>

      {/* CORE WORKSPACE */}
      <div className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 pb-24 md:pb-6 animate-fade-in">
        {/* Tab Contents Area - taking full width for maximum immersion */}
        <main className="w-full h-full">

          {/* TAB 1: MAP */}
          {currentTab === 'mappa' && (
            <div className="h-[600px] flex flex-col animate-fade-in relative rounded-2xl overflow-hidden shadow-2xl border border-white/5">
              <div ref={mapRef} className="absolute inset-0 z-10" style={{ height: '100%', width: '100%' }}></div>

              {/* Floating Map Panel (Title & Instructions) */}
              <div className="absolute top-4 left-4 z-20 max-w-sm glass-panel p-4 border border-white/10 shadow-2xl backdrop-blur-xl pointer-events-auto">
                <h2 className="text-base font-bold font-display text-white mb-1 flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-[#10b981]" /> Mappa Soccorsi
                </h2>
                <p className="text-[11px] text-gray-400 leading-relaxed mb-3">
                  Clicca in un punto qualsiasi della mappa per inserire una segnalazione GPS o clicca il pulsante qui sotto.
                </p>
                <button onClick={() => {
                  if (!user) {
                    setAuthMode('register');
                    setIsAuthModalOpen(true);
                    return;
                  }
                  if (userCoords) {
                    setNewReportLat(userCoords.lat);
                    setNewReportLng(userCoords.lng);
                  } else {
                    setNewReportLat(38.4250);
                    setNewReportLng(15.9010);
                  }
                  setShowReportModal(true);
                }} className="btn-primary w-full justify-center text-xs py-2 bg-gradient-to-tr from-[#10b981] to-[#059669] shadow-lg shadow-[#10b981]/25">
                  <PlusCircle className="w-4 h-4" /> Segnala Ora
                </button>
              </div>

              {/* Floating Map Legend (Bottom Left) */}
              <div className="absolute bottom-4 left-4 z-20 glass-panel p-3 text-[10px] w-fit flex flex-col gap-1.5 border border-white/5 shadow-2xl backdrop-blur-xl pointer-events-auto">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#10b981] inline-block border border-white/20"></span>
                  <span className="text-gray-300 font-semibold">Segnalazione Attiva</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#f59e0b] inline-block border border-white/20"></span>
                  <span className="text-gray-300 font-semibold">In Carico / Gestione</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#6366f1] inline-block border border-white/20"></span>
                  <span className="text-gray-300 font-semibold">Clinica Veterinaria</span>
                </div>
                <div className="flex items-center gap-2 font-semibold">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block animate-ping"></span>
                  <span className="text-gray-300 font-semibold">Hotspot Randagismo</span>
                </div>
              </div>

              {/* Floating Centering Button */}
              {userCoords && (
                <button 
                  onClick={() => {
                    if (mapInstanceRef.current) {
                      mapInstanceRef.current.setView([userCoords.lat, userCoords.lng], 15);
                    }
                  }}
                  className="absolute bottom-4 right-4 z-20 p-3 rounded-full bg-[#10b981] hover:bg-[#059669] text-white shadow-2xl transition-all border-none cursor-pointer flex items-center justify-center pointer-events-auto"
                  style={{ border: 'none', outline: 'none' }}
                  title="Centra sulla tua posizione"
                >
                  <Navigation className="w-5 h-5" />
                </button>
              )}
            </div>
          )}

          {/* TAB 2: REPORTS LIST */}
          {currentTab === 'segnalazioni' && (
            <div className="space-y-6 animate-fade-in">
              <div className="glass-panel p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold font-display text-white">Lista Segnalazioni</h2>
                  <p className="text-sm text-gray-400">Vedi e gestisci tutte le segnalazioni attive sul territorio.</p>
                </div>
                <div className="flex gap-2">
                  <select 
                    value={filterType} onChange={e => setFilterType(e.target.value)}
                    className="form-input text-xs"
                  >
                    <option value="all">Tutti gli animali</option>
                    <option value="cane">Cani</option>
                    <option value="gatto">Gatti</option>
                    <option value="altro">Altri</option>
                  </select>

                  <select 
                    value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                    className="form-input text-xs"
                  >
                    <option value="all">Tutti gli stati</option>
                    <option value="segnalato">Segnalati</option>
                    <option value="in_carico">In gestione</option>
                    <option value="risolto">Risolti</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredReports.length === 0 ? (
                  <div className="col-span-2 glass-panel p-8 text-center text-gray-400">
                    Nessuna segnalazione corrisponde ai filtri selezionati.
                  </div>
                ) : (
                  filteredReports.map(report => (
                    <div key={report.id} className="glass-panel p-5 flex flex-col justify-between hover:border-emerald-500/30 transition-all">
                      <div>
                        {/* Header card info */}
                        <div className="flex items-center justify-between mb-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold border ${report.animalType === 'cane' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-blue-500/10 text-blue-400 border-blue-500/20'}`}>
                            {report.animalType}
                          </span>
                          
                          {report.status === 'segnalato' && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase">Segnalato</span>
                          )}
                          {report.status === 'in_carico' && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 uppercase">In Carico</span>
                          )}
                          {report.status === 'risolto' && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-gray-500/10 text-gray-400 border border-gray-500/20 uppercase">Risolto</span>
                          )}
                        </div>

                        {/* Blurred Photo preview with custom moderation filter */}
                        {report.photoUrl && (
                          <div className="relative w-full h-40 rounded-lg overflow-hidden mb-3 border border-white/5 bg-gray-950">
                            <img 
                              src={report.photoUrl} 
                              alt="Animale" 
                              className={`w-full h-full object-cover transition-all ${report.sensitive ? 'blur-md filter scale-105' : ''}`}
                            />
                            {report.sensitive && (
                              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 p-4 text-center">
                                <Lock className="w-6 h-6 text-rose-400 mb-2" />
                                <span className="text-[11px] font-bold text-gray-200 uppercase tracking-wide">Immagine Sensibile</span>
                                <p className="text-[9px] text-gray-400 mt-1 max-w-[200px]">Potrebbe contenere sangue o ferite crude. Clicca sotto per vederla.</p>
                                <button 
                                  onClick={() => {
                                    const updated = reports.map(r => r.id === report.id ? { ...r, sensitive: false } : r);
                                    setReports(updated);
                                  }}
                                  className="mt-3 px-3 py-1 rounded bg-white/10 hover:bg-white/20 text-white text-[10px] font-semibold border border-white/10"
                                >
                                  Svela Immagine
                                </button>
                              </div>
                            )}
                          </div>
                        )}

                        <p className="text-sm text-gray-200 leading-relaxed mb-4">{report.description}</p>
                        
                        <div className="flex items-center gap-2 text-xs text-gray-400 mb-4 bg-white/2px p-2 rounded">
                          <MapPin className="w-3.5 h-3.5 text-emerald-400" />
                          <span>GPS: {report.latitude}, {report.longitude}</span>
                        </div>
                      </div>

                      {/* Actions footer */}
                      <div className="pt-4 border-t border-white/5 flex flex-col gap-2">
                        <div className="text-xs text-gray-400 flex items-center justify-between">
                          <span>Segnalato da: <strong className="text-gray-300">{report.reporterName}</strong></span>
                          <span>{new Date(report.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                        </div>

                        {report.status === 'segnalato' && (!user || user.role === 'volontario') && (
                          <button 
                            onClick={() => handleTakeCharge(report.id)}
                            className="btn-primary w-full text-xs justify-center py-2 mt-2"
                          >
                            Prendi in Carico Soccorso
                          </button>
                        )}

                        {report.status === 'in_carico' && report.volunteerId === user?.id && (
                          <div className="grid grid-cols-2 gap-2 mt-2">
                            <button 
                              onClick={() => handleResolveReport(report.id)}
                              className="btn-primary text-xs justify-center py-2"
                            >
                              <CheckCircle className="w-4 h-4" /> Risolto (+50 pt)
                            </button>
                            <button 
                              onClick={() => {
                                if (isServerOnline) {
                                  fetch(`${API_BASE}/reports/${report.id}/release`, {
                                    method: 'PATCH',
                                    headers: { 'Authorization': `Bearer ${token}` }
                                  }).then(() => loadServerData());
                                } else {
                                  const db = JSON.parse(localStorage.getItem('pawlink_db'));
                                  const r = db.reports.find(rep => rep.id === report.id);
                                  if (r) {
                                    r.status = 'segnalato';
                                    r.volunteerId = null;
                                    r.volunteerName = null;
                                    saveEmulatedDb(db);
                                    setReports(db.reports);
                                  }
                                }
                              }}
                              className="btn-secondary text-xs justify-center py-2"
                            >
                              Rilascia Gestione
                            </button>
                          </div>
                        )}

                        {report.status === 'in_carico' && report.volunteerId !== user?.id && (
                          <div className="text-xs bg-amber-950/20 border border-amber-500/20 rounded p-2 text-amber-400 mt-2 text-center">
                            In gestione da: <strong>{report.volunteerName}</strong>
                          </div>
                        )}

                        {report.status === 'risolto' && (
                          <div className="text-xs bg-emerald-950/20 border border-emerald-500/20 rounded p-2 text-emerald-400 mt-2 text-center flex items-center justify-center gap-1.5">
                            <CheckCircle className="w-4 h-4" /> Soccorso completato con successo
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* TAB 3: CHATS */}
          {currentTab === 'chat' && (
            !user ? (
              <div className="glass-panel p-8 text-center flex flex-col items-center justify-center gap-4 h-[400px]">
                <MessageSquare className="w-16 h-16 text-[#10b981] opacity-70 mb-2 animate-pulse" />
                <h3 className="text-lg font-bold font-display text-white">Area Riservata alle Chat</h3>
                <p className="text-sm text-gray-400 max-w-sm mx-auto">Registrati o accedi per partecipare ai canali geografici e coordinare le segnalazioni con i volontari.</p>
                <button 
                  onClick={() => {
                    setAuthMode('login');
                    setIsAuthModalOpen(true);
                  }} 
                  className="btn-primary mt-2"
                >
                  Accedi o Registrati
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-[540px] animate-fade-in">
              {/* Chat List Column */}
              <div className="md:col-span-1 glass-panel p-4 flex flex-col gap-3 h-full overflow-y-auto">
                <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider mb-2">Canali Attivi</h3>
                
                {chats.length === 0 ? (
                  <p className="text-xs text-gray-500 text-center py-4">Nessuna chat attiva al momento.</p>
                ) : (
                  chats.map(chat => (
                    <button
                      key={chat.id}
                      onClick={() => handleOpenChat(chat)}
                      className={`w-full text-left p-3 rounded-lg border transition-all flex flex-col gap-1 ${selectedChat?.id === chat.id ? 'bg-[#10b981]/15 border-[#10b981] text-white' : 'bg-white/2px border-white/5 hover:bg-white/5 text-gray-300'}`}
                    >
                      <div className="flex items-center gap-2 justify-between w-full">
                        <span className="font-bold text-xs truncate max-w-[120px]">{chat.name || `Chat ${chat.animalType.toUpperCase()}`}</span>
                        {chat.reportId && <span className="text-[8px] bg-amber-500/10 text-amber-400 px-1 border border-amber-500/20 rounded uppercase font-bold">Soccorso</span>}
                      </div>
                      <p className="text-[10px] text-gray-400 truncate w-full">
                        {chat.messages && chat.messages.length > 0 ? chat.messages[chat.messages.length - 1].text : 'Inizia la conversazione...'}
                      </p>
                    </button>
                  ))
                )}
              </div>

              {/* Chat Messages Column */}
              <div className="md:col-span-2 glass-panel p-4 flex flex-col h-full justify-between">
                {selectedChat ? (
                  <>
                    {/* Chat Header */}
                    <div className="pb-3 border-b border-white/5 flex items-center justify-between">
                      <div>
                        <h4 className="font-bold text-sm text-white font-display">{selectedChat.name || `Canale ${selectedChat.animalType.toUpperCase()}`}</h4>
                        <span className="text-[10px] text-gray-400">Canale protetto crittografato</span>
                      </div>
                    </div>

                    {/* Messages Body */}
                    <div className="flex-1 overflow-y-auto py-4 space-y-3 pr-2 scrollbar">
                      {activeChatMessages.map((msg, index) => {
                        const isMe = msg.senderId === user.id;
                        const isSystem = msg.senderId === 'system';

                        if (isSystem) {
                          return (
                            <div key={index} className="flex justify-center text-center">
                              <span className="px-3 py-1 rounded-full bg-white/5 border border-white/5 text-[10px] text-gray-400 max-w-[80%] leading-relaxed">
                                {msg.text}
                              </span>
                            </div>
                          );
                        }

                        return (
                          <div key={index} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                            <span className="text-[9px] text-gray-400 mb-0.5 px-1">{msg.senderName}</span>
                            <div className={`px-3 py-2 rounded-xl text-xs max-w-[75%] ${isMe ? 'bg-[#10b981] text-white rounded-tr-none' : 'bg-gray-800 text-gray-200 rounded-tl-none'}`}>
                              {msg.text}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Message Input Form */}
                    <form onSubmit={handleSendMessage} className="pt-3 border-t border-white/5 flex gap-2">
                      <input
                        type="text"
                        className="form-input flex-1 text-xs py-2.5"
                        placeholder="Scrivi un messaggio di coordinamento..."
                        value={chatInput}
                        onChange={e => setChatInput(e.target.value)}
                      />
                      <button type="submit" className="btn-primary p-2.5">
                        <Send className="w-4 h-4" />
                      </button>
                    </form>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-gray-500 text-center gap-3">
                    <MessageSquare className="w-12 h-12 stroke-1 text-gray-600" />
                    <p className="text-sm">Seleziona un canale a sinistra per avviare o continuare la chat.</p>
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* TAB 4: REWARDS */}
          {currentTab === 'premi' && (
            <div className="space-y-6 animate-fade-in">
              <div className="glass-panel p-5">
                <h2 className="text-xl font-bold font-display text-white">Raccolta Punti & Premi</h2>
                <p className="text-sm text-gray-400">Più soccorsi completi, più accumuli punti spendibili in sconti presso i nostri partner commerciali locali.</p>
              </div>

              {redeemedCoupon && (
                <div className="glass-panel p-5 bg-emerald-950/30 border-emerald-500/30 text-emerald-400 flex flex-col items-center justify-center text-center gap-2">
                  <CheckCircle className="w-10 h-10" />
                  <h3 className="font-bold font-display text-lg text-white">Codice Riscattato!</h3>
                  <p className="text-xs max-w-sm text-gray-300">{redeemedCoupon}</p>
                  <p className="text-[10px] text-gray-500 mt-2">Mostra questo codice coupon alla cassa dell\'attività convenzionata.</p>
                  <button onClick={() => setRedeemedCoupon(null)} className="btn-secondary text-[10px] py-1 px-3 mt-2">Chiudi</button>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {rewards.length === 0 ? (
                  <div className="col-span-3 glass-panel p-8 text-center text-gray-400">
                    Caricamento premi in corso...
                  </div>
                ) : (
                  rewards.map(rew => (
                    <div key={rew.id} className="glass-panel p-5 flex flex-col justify-between items-center text-center gap-4 hover:border-amber-500/20 transition-all">
                      <div className="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-400 border border-amber-500/20">
                        <Award className="w-6 h-6" />
                      </div>
                      <div>
                        <h4 className="font-bold text-sm text-white font-display leading-tight">{rew.title}</h4>
                        <span className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold block mt-1">Presso: {rew.partner}</span>
                      </div>

                      <div className="w-full pt-4 border-t border-white/5 flex items-center justify-between">
                        <span className="text-xs font-mono text-amber-400 font-bold">{rew.points} Punti</span>
                        <button 
                          onClick={() => handleRedeemReward(rew.id)}
                          disabled={user && user.points < rew.points}
                          className={`text-xs px-3 py-1.5 rounded font-bold border transition-all ${!user || user.points >= rew.points ? 'bg-amber-500 border-amber-600 text-white cursor-pointer hover:scale-105' : 'bg-gray-800 border-gray-700 text-gray-500 cursor-not-allowed'}`}
                        >
                          Riscatta
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* TAB 5: CLINICA ASSISTENTE IA */}
          {currentTab === 'triage' && (
            <div className="space-y-6 animate-fade-in">
              <div className="glass-panel p-5 border-purple-500/30">
                <h2 className="text-xl font-bold font-display text-white flex items-center gap-2">
                  <ShieldAlert className="w-6 h-6 text-purple-400" />
                  Clinica Assistente IA (Beta Triage)
                </h2>
                <p className="text-sm text-gray-400">Verifica i sintomi di un animale trovato per valutarne preliminarmente lo stato di gravità.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Form symptoms selector */}
                <div className="glass-panel p-5">
                  <h3 className="font-bold text-sm text-white mb-4">Seleziona Specie & Sintomi</h3>
                  <form onSubmit={handleDiagnose} className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-gray-300 uppercase mb-2">Specie Animale</label>
                      <select 
                        value={iaSpecies} onChange={e => setIaSpecies(e.target.value)}
                        className="form-input w-full text-xs"
                      >
                        <option value="cane">Cane</option>
                        <option value="gatto">Gatto</option>
                        <option value="altro">Altro Animale / Volatile</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-300 uppercase mb-2">Seleziona Sintomi Rilevati</label>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        {[
                          { val: 'sangue', label: 'Perdita di sangue' },
                          { val: 'letargia', label: 'Letargia/Apatia' },
                          { val: 'vomito', label: 'Vomito ripetuto' },
                          { val: 'zoppia', label: 'Zoppia evidente' },
                          { val: 'respirazione', label: 'Difficoltà respiratoria' },
                          { val: 'diarrea', label: 'Diarrea' },
                          { val: 'incosciente', label: 'Incoscienza' },
                          { val: 'convulsioni', label: 'Convulsioni/Tremori' }
                        ].map(sym => (
                          <button
                            key={sym.val} type="button"
                            onClick={() => toggleSymptom(sym.val)}
                            className={`p-2.5 rounded-lg border text-left font-semibold transition-all ${iaSymptoms.includes(sym.val) ? 'bg-purple-500/10 border-purple-500 text-purple-300' : 'bg-white/2px border-white/5 text-gray-400 hover:bg-white/5'}`}
                          >
                            {sym.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <button type="submit" className="btn-primary w-full justify-center text-xs py-3 bg-gradient-to-tr from-purple-500 to-indigo-600 shadow-purple-500/20">
                      Valuta Sintomi con IA
                    </button>
                  </form>
                </div>

                {/* IA Response Output */}
                <div className="glass-panel p-5 flex flex-col justify-between border-white/5">
                  {iaDiagnosis ? (
                    <div className="space-y-4">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${iaDiagnosis.level === 'ROSSO' ? 'bg-red-500/20 text-red-300 border border-red-500/30' : iaDiagnosis.level === 'GIALLO' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'}`}>
                          Codice {iaDiagnosis.level} - {iaDiagnosis.label}
                        </span>
                      </div>
                      
                      <h4 className="font-bold text-white text-base">Valutazione Clinica Emulata</h4>
                      <p className="text-xs text-gray-300 leading-relaxed">{iaDiagnosis.description}</p>
                      
                      <div>
                        <h5 className="font-bold text-xs text-gray-400 uppercase mb-2">Raccomandazioni di Sicurezza:</h5>
                        <ul className="text-[11px] text-gray-400 list-disc pl-4 space-y-1.5 leading-relaxed">
                          {iaDiagnosis.recommendations.map((rec, i) => <li key={i}>{rec}</li>)}
                        </ul>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-gray-500 text-center gap-3">
                      <Info className="w-12 h-12 stroke-1 text-gray-600" />
                      <p className="text-xs max-w-[200px]">Inserisci i sintomi a sinistra per ricevere una prima valutazione preliminare istantanea.</p>
                    </div>
                  )}

                  <div className="pt-4 border-t border-white/5 mt-6 text-[10px] text-gray-500 leading-relaxed">
                    <strong>ATTENZIONE:</strong> Questa valutazione è generata da un sistema di intelligenza artificiale. Non sostituisce in alcun modo l\'ispezione fisica e la consulenza qualificata di un medico veterinario iscritto all\'albo.
                  </div>
                </div>
              </div>
            </div>
          )}

        </main>
      </div>

      {/* FOOTER */}
      <footer className="glass-header mt-auto py-4 px-6 text-center text-xs text-gray-400 border-t border-white/5">
        <p>© 2026 PawLink. Piattaforma per la tutela, il soccorso e la salvaguardia degli animali e dei randagi su tutto il territorio.</p>
      </footer>

      {/* DIALOG 1: REPORT AD HOC FORM */}
      {showReportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="glass-panel max-w-md w-full p-6 animate-fade-in max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold font-display text-white mb-4">Nuova Segnalazione GPS</h3>
            
            <form onSubmit={handleCreateReport} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-300 uppercase mb-1">Specie Animale</label>
                <select 
                  value={newReportType} onChange={e => setNewReportType(e.target.value)}
                  className="form-input w-full text-xs"
                >
                  <option value="cane">Cane</option>
                  <option value="gatto">Gatto</option>
                  <option value="altro">Altro</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-300 uppercase mb-1">Seleziona una foto (Demo)</label>
                <div className="grid grid-cols-2 gap-2">
                  {MOCK_ANIMAL_PHOTOS.map((ph, idx) => (
                    <button
                      key={idx} type="button"
                      onClick={() => setSelectedPhotoUrl(ph.url)}
                      className={`p-1 rounded-lg border overflow-hidden h-20 transition-all ${selectedPhotoUrl === ph.url ? 'border-[#10b981] bg-[#10b981]/15' : 'border-white/5 bg-gray-900'}`}
                    >
                      <img src={ph.url} alt={ph.name} className="w-full h-full object-cover rounded" />
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-300 uppercase mb-1">Descrizione Dettagliata</label>
                <textarea 
                  required rows="3"
                  className="form-input w-full text-xs"
                  placeholder="Scrivi dove si trova, l'aspetto e lo stato di salute (es. Cane ferito a bordo strada, indossa collare rosso...)"
                  value={newReportDesc} onChange={e => setNewReportDesc(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-gray-300 uppercase mb-1">Latitudine (GPS)</label>
                  <input 
                    type="number" step="0.0001" required
                    className="form-input w-full text-xs"
                    value={newReportLat} onChange={e => setNewReportLat(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-300 uppercase mb-1">Longitudine (GPS)</label>
                  <input 
                    type="number" step="0.0001" required
                    className="form-input w-full text-xs"
                    value={newReportLng} onChange={e => setNewReportLng(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-4 border-t border-white/5">
                <button type="submit" disabled={isReportSubmitting} className="btn-primary flex-1 justify-center py-2.5 text-xs">
                  {isReportSubmitting ? 'Inviando...' : 'Pubblica Segnalazione'}
                </button>
                <button type="button" onClick={() => setShowReportModal(false)} className="btn-secondary text-xs">
                  Annulla
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DIALOG 2: LOGIN / REGISTER MODAL */}
      {isAuthModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="glass-panel max-w-md w-full p-8 animate-fade-in relative max-h-[90vh] overflow-y-auto">
            <button 
              onClick={() => setIsAuthModalOpen(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-white font-bold text-sm bg-transparent border-0 cursor-pointer"
            >
              ✕
            </button>
            <div className="flex flex-col items-center mb-6">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-[#10b981] to-[#059669] flex items-center justify-center shadow-lg shadow-[#10b981]/25 mb-3">
                <Heart className="w-6 h-6 text-white fill-white" />
              </div>
              <h3 className="text-xl font-bold text-white font-display">Area Riservata PawLink</h3>
              <p className="text-xs text-gray-400 mt-1 text-center">Accedi o registrati per effettuare segnalazioni, prendere in carico i soccorsi o chattare.</p>
            </div>

            <form onSubmit={handleAuthSubmit} className="space-y-4">
              {authMode === 'register' && (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-gray-300 uppercase mb-1">Nome Completo</label>
                    <input 
                      type="text" required
                      className="form-input w-full"
                      placeholder="Esempio: Mario Rossi"
                      value={name} onChange={e => setName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-300 uppercase mb-1">Telefono</label>
                    <input 
                      type="tel"
                      className="form-input w-full"
                      placeholder="Esempio: 333 1234567"
                      value={phone} onChange={e => setPhone(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-300 uppercase mb-2">Il tuo Ruolo</label>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="cursor-pointer">
                        <input 
                          type="radio" name="role" className="hidden role-radio" 
                          checked={role === 'cittadino'} onChange={() => setRole('cittadino')}
                        />
                        <div className="role-card-label text-center py-2 text-sm">Cittadino</div>
                      </label>
                      <label className="cursor-pointer">
                        <input 
                          type="radio" name="role" className="hidden role-radio" 
                          checked={role === 'volontario'} onChange={() => setRole('volontario')}
                        />
                        <div className="role-card-label text-center py-2 text-sm">Volontario</div>
                      </label>
                    </div>
                  </div>
                </>
              )}

              <div>
                <label className="block text-xs font-semibold text-gray-300 uppercase mb-1">Email</label>
                <input 
                  type="email" required
                  className="form-input w-full"
                  placeholder="nome@esempio.it"
                  value={email} onChange={e => setEmail(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-300 uppercase mb-1">Password</label>
                <input 
                  type="password" required
                  className="form-input w-full"
                  placeholder="••••••••"
                  value={password} onChange={e => setPassword(e.target.value)}
                />
              </div>

              {authError && (
                <div className="bg-red-950/40 border border-red-500/50 rounded-lg p-3 text-xs text-red-300 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{authError}</span>
                </div>
              )}

              <button type="submit" className="btn-primary w-full justify-center py-3 text-base">
                {authMode === 'login' ? 'Accedi' : 'Registrati'}
              </button>
            </form>

            <div className="mt-6 text-center text-sm">
              <button 
                className="text-[#10b981] hover:underline bg-transparent border-0 cursor-pointer"
                onClick={() => {
                  setAuthMode(authMode === 'login' ? 'register' : 'login');
                  setAuthError('');
                }}
              >
                {authMode === 'login' ? 'Non hai un account? Registrati' : 'Hai già un account? Accedi'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Floating Bottom Bar */}
      <nav className="lg:hidden fixed bottom-4 left-4 right-4 z-40 glass-panel p-2 flex justify-around items-center border border-white/10 shadow-2xl backdrop-blur-xl rounded-2xl">
        <button 
          onClick={() => setCurrentTab('mappa')}
          className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all bg-transparent border-0 cursor-pointer ${currentTab === 'mappa' ? 'text-[#10b981] scale-105' : 'text-gray-400'}`}
        >
          <MapPin className="w-5 h-5" />
          <span className="text-[9px] font-semibold">Mappa</span>
        </button>
        <button 
          onClick={() => setCurrentTab('segnalazioni')}
          className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all bg-transparent border-0 cursor-pointer ${currentTab === 'segnalazioni' ? 'text-[#10b981] scale-105' : 'text-gray-400'}`}
        >
          <div className="relative">
            <AlertTriangle className="w-5 h-5" />
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-500 border border-[#0b0f19]"></span>
          </div>
          <span className="text-[9px] font-semibold">Segnalazioni</span>
        </button>
        <button 
          onClick={() => setCurrentTab('chat')}
          className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all bg-transparent border-0 cursor-pointer ${currentTab === 'chat' ? 'text-[#10b981] scale-105' : 'text-gray-400'}`}
        >
          <MessageSquare className="w-5 h-5" />
          <span className="text-[9px] font-semibold">Chat</span>
        </button>
        <button 
          onClick={() => setCurrentTab('premi')}
          className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all bg-transparent border-0 cursor-pointer ${currentTab === 'premi' ? 'text-[#10b981] scale-105' : 'text-gray-400'}`}
        >
          <Award className="w-5 h-5" />
          <span className="text-[9px] font-semibold">Premi</span>
        </button>
        <button 
          onClick={() => setCurrentTab('triage')}
          className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all bg-transparent border-0 cursor-pointer ${currentTab === 'triage' ? 'text-[#10b981] scale-105' : 'text-gray-400'}`}
        >
          <ShieldAlert className="w-5 h-5 text-purple-400" />
          <span className="text-[9px] font-semibold text-purple-300">Triage IA</span>
        </button>
      </nav>
    </div>
  );
}
