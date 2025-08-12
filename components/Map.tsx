import { useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Text,
  Modal,
  Alert,
  TextInput,
  FlatList,
  ActivityIndicator,
  Keyboard,
  Platform,
  Image,
} from 'react-native';
import Mapbox, { MapView, Camera, UserLocation, MarkerView } from '@rnmapbox/maps';
import * as Location from 'expo-location';

const MAPBOX_TOKEN =
  'pk.eyJ1IjoiZXJhbmdyOTAiLCJhIjoiY21kYmJpdTNoMDRyZTJxczIyYTU3NHFxNiJ9.VjCGEFeXxnYsuZ8eHARFZw';

Mapbox.setAccessToken(MAPBOX_TOKEN);

// Events
const EVENTS = {
  שרפה: '🔥',
  'זריקת אבנים': '🪨',
  'פיגוע דקירה': '🔪',
  'בקבוק תעברה': '🧨',
  מחבל: '🥷🏻',
  'פיגוע דריסה': '🚗💥',
} as const;

type EventType = keyof typeof EVENTS;

interface MarkerItem {
  id: string;
  coordinates: [number, number];
  icon: string;
}

interface GeoFeature {
  id: string;
  place_name: string;
  text: string;
  center: [number, number]; // [lon, lat]
}

export default function Map() {
  const [location, setLocation] = useState<[number, number] | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<EventType | null>(null);
  const [markers, setMarkers] = useState<MarkerItem[]>([]);
  const [modalVisible, setModalVisible] = useState(false);

  // Search state
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeoFeature[]>([]);
  const [loading, setLoading] = useState(false);
  const [openList, setOpenList] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // open-close menu
  const [menuOpen, setMenuOpen] = useState(false);

  // Map ready gate
  const [mapReady, setMapReady] = useState(false);
  const [didCenter, setDidCenter] = useState(false); // why: ensure first focus on real user fix
  const [followMe, setFollowMe] = useState(true); // follow user at startup
  const [userCoord, setUserCoord] = useState<[number, number] | null>(null);

  // Camera ref (why: we control camera imperatively only after map is ready)
  const cameraRef = useRef<Camera | null>(null);

  const uniqueId = () => `${Date.now()}-${Math.round(Math.random() * 1e6)}`;

  // Get user location
  const getUserLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const userLocation = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      const { longitude, latitude } = userLocation.coords;
      setLocation([longitude, latitude]);
      setUserCoord([longitude, latitude]);
    } catch (error) {
      console.error('Error getting user location:', error);
    }
  };

  useEffect(() => {
    getUserLocation();
  }, []);

  // Position camera when map is ready + we have a location
  useEffect(() => {
    if (!mapReady || !location || !cameraRef.current || didCenter) return;
    cameraRef.current.setCamera({
      centerCoordinate: location,
      zoomLevel: 14,
      animationMode: 'flyTo',
      animationDuration: 1000,
    });
    setDidCenter(true);
  }, [mapReady, location, didCenter]);

  // open-close Add events
  const handleAddEvent = () => setModalVisible(true);

  // Select Event
  const handleSelectEvent = (eventType: EventType) => {
    setSelectedEvent(eventType);
    setModalVisible(false);
  };

  // Add marker
  const handleMapPress = (e: any) => {
    if (!selectedEvent) return;
    const coords = e.geometry.coordinates as [number, number];
    setMarkers((prev) => [
      ...prev,
      { id: uniqueId(), coordinates: coords, icon: EVENTS[selectedEvent] },
    ]);
    setSelectedEvent(null);
  };

  // Long press - remove marker
  const handleLongPressMarker = (id: string) => {
    Alert.alert('הסר אירוע', 'האם אתה בטוח שברצונך למחוק אירוע זה?', [
      { text: 'ביטול', style: 'cancel' },
      { text: 'כן', onPress: () => setMarkers((prev) => prev.filter((m) => m.id !== id)) },
    ]);
  };

  // --- Search ---
  const searchCities = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({
        access_token: MAPBOX_TOKEN,
        types: 'place,locality,region',
        limit: '7',
        language: 'he',
      });
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
        trimmed
      )}.json?${params.toString()}`;
      const res = await fetch(url);
      const json = await res.json();
      const feats: GeoFeature[] = (json?.features ?? []).map((f: any) => ({
        id: f.id,
        place_name: f.place_name,
        text: f.text,
        center: f.center,
      }));
      setResults(feats);
    } catch (e) {
      console.error('Geocoding error', e);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const onChangeQuery = (text: string) => {
    setQuery(text);
    setOpenList(true);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      searchCities(text);
    }, 350);
  };

  const focusOnFeature = (feature: GeoFeature) => {
    const [lon, lat] = feature.center;
    setLocation([lon, lat]);
    setOpenList(false);
    setQuery(feature.text);
    Keyboard.dismiss();

    if (cameraRef.current) {
      cameraRef.current.setCamera({
        centerCoordinate: [lon, lat],
        zoomLevel: 11,
        animationMode: 'flyTo',
        animationDuration: 1000,
      });
    }
  };

  const centerToMe = async () => {
    if (!mapReady || !cameraRef.current) return;

    let target = userCoord;

    // If we haven’t received a GPS fix yet, fetch one now
    if (!target) {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const last = await Location.getLastKnownPositionAsync();
        const pos =
          last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }));
        target = [pos.coords.longitude, pos.coords.latitude];
        setUserCoord(target);
      } catch {
        return;
      }
    }

    // Nudge now and re-enable follow so it tracks the user again
    setFollowMe(false);
    cameraRef.current.setCamera({
      centerCoordinate: target,
      zoomLevel: 14,
      animationMode: 'flyTo',
      animationDuration: 600,
    });
    requestAnimationFrame(() => setFollowMe(true));
  };

  // Mapbox user-location first-focus (why: Mapbox gets GPS slightly earlier than expo sometimes)
  const handleUserLocationUpdate = (pos: any) => {
    if (didCenter || !mapReady || !pos?.coords) return;
    const { longitude, latitude } = pos.coords;
    if (typeof longitude !== 'number' || typeof latitude !== 'number') return;
    const coord: [number, number] = [longitude, latitude];
    setUserCoord(coord);
    setLocation(coord);
    cameraRef.current?.setCamera({
      centerCoordinate: coord,
      zoomLevel: 14,
      animationMode: 'flyTo',
      animationDuration: 800,
    });
    setDidCenter(true);
  };

  return (
    <View style={{ flex: 1 }}>
      {/* Search bar + menu */}
      <View style={styles.searchWrap} pointerEvents="box-none">
        {/* Round hamburger */}
        <View>
          <TouchableOpacity style={styles.menuBtn} onPress={() => setMenuOpen((v) => !v)}>
            <Text style={styles.menuIcon}>≡</Text>
          </TouchableOpacity>

          {menuOpen && (
            <View style={styles.menuDropdown}>
              <TouchableOpacity style={styles.menuItem} onPress={centerToMe}>
                <Text style={styles.menuItemText}>חזרה למיקום שלי</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.menuItem} onPress={() => console.log('clicked')}>
                <Text style={styles.menuItemText}>הגדרות</Text>
                <Image source={require('../assets/icons/setting.png')} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.menuItem} onPress={() => console.log('clicked')}>
                <Text style={styles.menuItemText}>היסטוריית התראות</Text>
                <Image source={require('../assets/icons/history.png')} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.menuItem} onPress={() => console.log('clicked')}>
                <Text style={styles.menuItemText}>צרו עמנו קשר</Text>
                <Image source={require('../assets/icons/Contact.png')} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.menuItem} onPress={() => console.log('clicked')}>
                <Text style={styles.menuItemText}>אודות היישומון</Text>
                <Image source={require('../assets/icons/info.png')} />
              </TouchableOpacity>
            </View>
          )}
        </View>
        <View style={styles.inputBox}>
          {loading ? <ActivityIndicator style={styles.searchSpinner} /> : null}

          <Image source={require('../assets/icons/Search.png')} style={styles.searchIcon} />

          <TextInput
            value={query}
            onChangeText={onChangeQuery}
            placeholder="חפש עיר..."
            placeholderTextColor="#666"
            style={styles.searchInput}
            onFocus={() => setOpenList(true)}
            returnKeyType="search"
            onSubmitEditing={() => searchCities(query)}
          />

          {openList && (results.length > 0 || loading) && (
            <View style={styles.dropdown}>
              <FlatList
                keyboardShouldPersistTaps="handled"
                data={results}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity style={styles.item} onPress={() => focusOnFeature(item)}>
                    <Text numberOfLines={1} style={styles.itemText}>
                      {item.place_name}
                    </Text>
                  </TouchableOpacity>
                )}
                ListEmptyComponent={
                  loading ? null : (
                    <Text style={styles.emptyText}>לא נמצאו תוצאות, נסה מחרוזת אחרת</Text>
                  )
                }
              />
            </View>
          )}
        </View>
      </View>

      <MapView
        style={{ flex: 1 }}
        styleURL="mapbox://styles/erangr90/cmdeeuopg003g01qy73xgavkp"
        localizeLabels
        onPress={handleMapPress}
        onTouchStart={() => {
          setOpenList(false);
          setFollowMe(false); // user interacted -> stop auto-follow
        }}
        onDidFinishRenderingMapFully={() => setMapReady(true)}>
        {/* Follow user initially; still keep ref for later setCamera calls */}
        <Camera
          ref={cameraRef as any}
          followUserLocation={followMe}
          followUserMode={Mapbox.UserTrackingMode.Follow}
          followZoomLevel={14}
        />

        <UserLocation
          visible
          androidRenderMode="compass"
          showsUserHeadingIndicator
          onUpdate={handleUserLocationUpdate}
        />

        {mapReady &&
          markers.map((marker) => (
            <MarkerView key={marker.id} coordinate={marker.coordinates} allowOverlap>
              {/* why: collapsable=false ensures Android keeps this View for native tag lookup */}
              <View collapsable={false}>
                <TouchableOpacity onLongPress={() => handleLongPressMarker(marker.id)}>
                  <Text style={{ fontSize: 24 }}>{marker.icon}</Text>
                </TouchableOpacity>
              </View>
            </MarkerView>
          ))}
      </MapView>

      <TouchableOpacity style={styles.button} onPress={handleAddEvent}>
        <Text style={styles.buttonText}>➕</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.stress_button} onPress={() => console.log('Click')}>
        <Text style={styles.buttonText}>❕</Text>
      </TouchableOpacity>

      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>בחר אירוע</Text>
            {Object.entries(EVENTS).map(([key, icon]) => (
              <TouchableOpacity
                key={key}
                style={styles.modalItem}
                onPress={() => handleSelectEvent(key as EventType)}>
                <Text style={styles.modalItemText}>
                  {key} {icon}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.modalCancel} onPress={() => setModalVisible(false)}>
              <Text style={styles.modalCancelText}>ביטול</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const SHADOW: any =
  Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOpacity: 0.15,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 3 },
    },
    android: { elevation: 6 },
  }) || {};

const styles = StyleSheet.create({
  searchWrap: {
    position: 'absolute',
    top: 50,
    left: 12,
    right: 12,
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  inputBox: {
    flex: 1,
    position: 'relative',
  },
  searchIcon: {
    position: 'absolute',
    left: 4,
    top: 12,
    width: 40,
    height: 20,
    tintColor: '#666',
    zIndex: 2,
  },
  searchInput: {
    height: 44,
    borderRadius: 10,
    paddingLeft: 40,
    paddingRight: 44,
    backgroundColor: '#fff',
    ...SHADOW,
  },
  searchSpinner: {
    position: 'absolute',
    right: 12,
    top: 10,
    zIndex: 2,
  },
  dropdown: {
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    marginTop: 6,
    maxHeight: 260,
    backgroundColor: '#fff',
    borderRadius: 10,
    overflow: 'hidden',
    ...SHADOW,
  },
  item: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  itemText: { fontSize: 14 },
  emptyText: { textAlign: 'center', padding: 16, color: '#666' },

  button: {
    position: 'absolute',
    bottom: 40,
    left: 30,
    backgroundColor: 'white',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    elevation: 3,
  },
  stress_button: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    backgroundColor: 'red',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    elevation: 3,
  },
  buttonText: { fontSize: 16 },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    width: '80%',
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 20,
  },
  modalTitle: {
    fontSize: 18,
    marginBottom: 10,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  modalItem: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
  },
  modalItemText: { fontSize: 16 },
  modalCancel: { marginTop: 10, paddingVertical: 10 },
  modalCancelText: { fontSize: 16, color: 'red', textAlign: 'center' },
  menuBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOW,
  },
  menuIcon: {
    fontSize: 22,
    lineHeight: 22,
  },
  menuDropdown: {
    position: 'absolute',
    top: 52,
    right: 0,
    width: 180,
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    zIndex: 999,
    transform: [{ translateX: -130 }],
    ...SHADOW,
  },
  menuItem: {
    flexDirection: 'row',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  menuItemText: {
    fontSize: 15,
  },
});
