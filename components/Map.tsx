import React, { useEffect, useRef, useState, useCallback } from 'react';
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
  ImageSourcePropType,
} from 'react-native';
import Mapbox, { MapView, Camera, MarkerView, UserLocation } from '@rnmapbox/maps';
import * as Location from 'expo-location';

/**
 * Map screen with:
 * - Search (Mapbox Geocoding)
 * - User location centering
 * - Event markers (icon + background ring)
 *
 * "Why" comments highlight intent behind non-obvious choices.
 */

// ────────────────────────────────────────────────────────────────────────────────
// Config & constants
// ────────────────────────────────────────────────────────────────────────────────
const MAPBOX_TOKEN =
  'pk.eyJ1IjoiZXJhbmdyOTAiLCJhIjoiY21kYmJpdTNoMDRyZTJxczIyYTU3NHFxNiJ9.VjCGEFeXxnYsuZ8eHARFZw';

Mapbox.setAccessToken(MAPBOX_TOKEN);

const STYLE_URL = 'mapbox://styles/erangr90/cmdeeuopg003g01qy73xgavkp';

const CMENU_SRC: Record<string, ImageSourcePropType> = {
  'פיגוע דקירה': require('../assets/icons/cEvents/knife.png'),
  'פיגוע דריסה': require('../assets/icons/cEvents/rollOver.png'),
  'פיגוע ירי': require('../assets/icons/cEvents/gun.png'),
  'זריקת אבנים': require('../assets/icons/cEvents/rock.png'),
  'חפץ חשוד': require('../assets/icons/cEvents/case.png'),
  'בקבוק תעברה': require('../assets/icons/cEvents/bottle.png'),
  'טילים\\ כלי טיס': require('../assets/icons/cEvents/rocket.png'),
  שריפה: require('../assets/icons/cEvents/fire.png'),
};

type EventType = keyof typeof CMENU_SRC;

// [event icon, radio ring]
const marks: Record<EventType, [ImageSourcePropType, ImageSourcePropType]> = {
  'פיגוע דקירה': [
    require('../assets/icons/marks/knife.png'),
    require('../assets/icons/radios/small.png'),
  ],
  'פיגוע דריסה': [
    require('../assets/icons/marks/carHit.png'),
    require('../assets/icons/radios/mid.png'),
  ],
  'פיגוע ירי': [
    require('../assets/icons/marks/gun.png'),
    require('../assets/icons/radios/mid.png'),
  ],
  'זריקת אבנים': [
    require('../assets/icons/marks/rock.png'),
    require('../assets/icons/radios/mid.png'),
  ],
  'חפץ חשוד': [
    require('../assets/icons/marks/case.png'),
    require('../assets/icons/radios/small.png'),
  ],
  'בקבוק תעברה': [
    require('../assets/icons/marks/molotov.png'),
    require('../assets/icons/radios/mid.png'),
  ],
  'טילים\\ כלי טיס': [
    require('../assets/icons/marks/missle.png'),
    require('../assets/icons/radios/big.png'),
  ],
  שריפה: [require('../assets/icons/marks/fire.png'), require('../assets/icons/radios/big.png')],
};

interface MarkerModel {
  id: string;
  coordinates: [number, number];
  icons: [ImageSourcePropType, ImageSourcePropType];
}

interface GeoFeature {
  id: string;
  place_name: string;
  text: string;
  center: [number, number]; // [lon, lat]
}

const COUNTRY = 'il'; // Israel
// [minLon, minLat, maxLon, maxLat]
const ISRAEL_BBOX: [number, number, number, number] = [34.2, 29.3, 35.95, 33.6];

// ────────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────────
export default function Map() {
  // Location & map
  const [location, setLocation] = useState<[number, number] | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const lastUserCoordRef = useRef<[number, number] | null>(null);
  const cameraRef = useRef<any>(null); // SDK types vary per version

  // UI state
  const [menuOpen, setMenuOpen] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);

  // Markers
  const [markers, setMarkers] = useState<MarkerModel[]>([]);

  // Search state
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeoFeature[]>([]);
  const [loading, setLoading] = useState(false);
  const [openList, setOpenList] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ────────────────────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────────────────────

  /** Get a usable coordinate.
   *  Why: centralize permission/accuracy flow to avoid repetition/bugs.
   */
  const ensureCoordinate = useCallback(async (): Promise<[number, number] | null> => {
    const existing = lastUserCoordRef.current || location;
    if (existing) return existing;
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return null;
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const coord: [number, number] = [pos.coords.longitude, pos.coords.latitude];
      lastUserCoordRef.current = coord;
      setLocation(coord);
      return coord;
    } catch (e) {
      return null;
    }
  }, [location]);

  /** Move camera atomically if possible. */
  const moveCamera = useCallback((center: [number, number], zoom: number, duration = 800) => {
    if (!cameraRef.current) return;
    if (cameraRef.current.setCamera) {
      cameraRef.current.setCamera({
        centerCoordinate: center,
        zoomLevel: zoom,
        animationMode: 'flyTo',
        animationDuration: duration,
      });
    } else {
      cameraRef.current.flyTo?.(center, duration);
      requestAnimationFrame(() => cameraRef.current?.zoomTo?.(zoom, Math.max(400, duration - 200)));
    }
  }, []);

  // ────────────────────────────────────────────────────────────────────────────
  // Effects
  // ────────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    // Prefetch a starting location.
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      try {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        setLocation([pos.coords.longitude, pos.coords.latitude]);
      } catch {}
    })();
  }, []);

  // ────────────────────────────────────────────────────────────────────────────
  // Handlers
  // ────────────────────────────────────────────────────────────────────────────

  const centerToMe = useCallback(async () => {
    const coord = await ensureCoordinate();
    if (!coord) return Alert.alert('שגיאה', 'אין הרשאת מיקום');
    if (!mapReady) return; // Why: avoid calling camera before style load
    moveCamera(coord, 14, 800);
  }, [ensureCoordinate, mapReady, moveCamera]);

  const handleAddEvent = () => setModalVisible(true);

  const handleSelectEvent = useCallback(
    async (eventType: EventType) => {
      const coord = await ensureCoordinate();
      if (!coord) return Alert.alert('שגיאה', 'לא ניתן לקבל מיקום נוכחי');

      setMarkers((prev) => [
        ...prev,
        { id: Date.now().toString(), coordinates: coord, icons: marks[eventType] },
      ]);

      if (mapReady) moveCamera(coord, 15, 700);
      setModalVisible(false);
    },
    [ensureCoordinate, mapReady, moveCamera]
  );

  const handleLongPressMarker = (id: string) => {
    Alert.alert('הסר אירוע', 'האם אתה בטוח שברצונך למחוק אירוע זה?', [
      { text: 'ביטול', style: 'cancel' },
      { text: 'כן', onPress: () => setMarkers((prev) => prev.filter((m) => m.id !== id)) },
    ]);
  };

  // Geocoding search
  const searchCities = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) {
        setResults([]);
        return;
      }
      setLoading(true);
      try {
        const prox = lastUserCoordRef.current || location; // [lon, lat]
        const proximity = prox ? `&proximity=${prox[0]},${prox[1]}` : '';

        const url =
          `https://api.mapbox.com/geocoding/v5/mapbox.places/` +
          `${encodeURIComponent(trimmed)}.json` +
          `?access_token=${MAPBOX_TOKEN}` +
          `&types=place,locality,region` +
          `&limit=7` +
          `&language=he` +
          `&country=${COUNTRY}` +
          `&bbox=${ISRAEL_BBOX.join(',')}` +
          proximity;

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
    },
    [location]
  );

  const onChangeQuery = (text: string) => {
    setQuery(text);
    setOpenList(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      searchCities(text);
    }, 350);
  };

  const focusOnFeature = (feature: GeoFeature) => {
    const coord = feature.center as [number, number];
    setOpenList(false);
    setQuery(feature.text);
    Keyboard.dismiss();
    setLocation(coord);

    if (mapReady) moveCamera(coord, 11, 900);
    else setTimeout(() => moveCamera(coord, 11, 900), 100);
  };

  // ────────────────────────────────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1 }}>
      {/* Top bar: menu + search */}
      <View style={styles.searchWrap}>
        {/* Menu */}
        <View>
          <TouchableOpacity style={styles.menuBtn} onPress={() => setMenuOpen((v) => !v)}>
            <Text style={styles.menuIcon}>≡</Text>
          </TouchableOpacity>

          {menuOpen && (
            <View style={styles.menuDropdown}>
              <TouchableOpacity style={styles.menuItem} onPress={() => console.log('הגדרות')}>
                <Text style={styles.menuItemText}>הגדרות</Text>
                <Image
                  source={require('../assets/icons/menu/setting.png')}
                  style={styles.menuItemIcon}
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => console.log('היסטוריית התרעות')}>
                <Text style={styles.menuItemText}>היסטוריית התרעות</Text>
                <Image
                  source={require('../assets/icons/menu/history.png')}
                  style={styles.menuItemIcon}
                />
              </TouchableOpacity>
              <TouchableOpacity style={styles.menuItem} onPress={() => console.log('צרו עמנו קשר')}>
                <Text style={styles.menuItemText}>צרו עמנו קשר</Text>
                <Image
                  source={require('../assets/icons/menu/contact.png')}
                  style={styles.menuItemIcon}
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => console.log('אודות היישומון')}>
                <Text style={styles.menuItemText}>אודות היישמון</Text>
                <Image
                  source={require('../assets/icons/menu/info.png')}
                  style={styles.menuItemIcon}
                />
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Search */}
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
                  loading ? null : <Text style={styles.emptyText}>לא נמצאו תוצאות</Text>
                }
              />
            </View>
          )}
        </View>
      </View>

      <MapView
        style={{ flex: 1 }}
        styleURL={STYLE_URL}
        localizeLabels
        onTouchStart={() => setOpenList(false)}
        onDidFinishLoadingStyle={() => setMapReady(true)}>
        {location && (
          <Camera
            ref={cameraRef}
            defaultSettings={{ centerCoordinate: location, zoomLevel: 14 }}
            animationMode="flyTo"
            animationDuration={1000}
          />
        )}

        {/* Blue puck */}
        <UserLocation
          visible
          androidRenderMode="compass"
          showsUserHeadingIndicator
          onUpdate={(loc) => {
            // Why: keep freshest GPS without re-renders; used to bias search & centering.
            if (loc?.coords) {
              lastUserCoordRef.current = [loc.coords.longitude, loc.coords.latitude];
            }
          }}
        />

        {markers.map((marker) => (
          <MarkerView key={marker.id} id={marker.id} coordinate={marker.coordinates}>
            <TouchableOpacity
              onLongPress={() => handleLongPressMarker(marker.id)}
              activeOpacity={0.8}>
              <View style={styles.markerWrap}>
                <Image source={marker.icons[1]} style={styles.markerBg} />
                <Image source={marker.icons[0]} style={styles.markerFg} />
              </View>
            </TouchableOpacity>
          </MarkerView>
        ))}
      </MapView>

      {/* Add event */}
      <TouchableOpacity style={styles.button} onPress={handleAddEvent}>
        <Text style={styles.buttonText}>➕</Text>
      </TouchableOpacity>

      {/* Recenter */}
      <TouchableOpacity style={styles.gpsBtn} onPress={centerToMe}>
        <Text style={styles.buttonText}>📍</Text>
      </TouchableOpacity>

      {/* SOS / Stress */}
      <TouchableOpacity style={styles.stress_button} onPress={() => console.log('save me button')}>
        <Text style={styles.buttonText}>❕</Text>
      </TouchableOpacity>

      {/* Events modal */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>בחר אירוע</Text>
            <FlatList
              data={Object.keys(CMENU_SRC) as EventType[]}
              numColumns={3}
              keyExtractor={(k) => k}
              columnWrapperStyle={styles.gridRow}
              contentContainerStyle={{ paddingTop: 8 }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.gridItem}
                  onPress={() => handleSelectEvent(item)}
                  activeOpacity={0.8}>
                  <Image source={CMENU_SRC[item]} style={styles.gridIcon} />
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity style={styles.modalCancel} onPress={() => setModalVisible(false)}>
              <Text style={styles.modalCancelText}>ביטול</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────────────────
// Styles (unused rules removed)
// ────────────────────────────────────────────────────────────────────────────────
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
    paddingLeft: 40, // leave room for icon
    paddingRight: 44, // leave room for spinner
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
  gpsBtn: {
    position: 'absolute',
    bottom: 40,
    right: 20,
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
    zIndex: 999, // keep above search input
    transform: [{ translateX: -130 }], // shift left so it doesn't get cut
    ...SHADOW,
  },
  menuItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  menuItemText: {
    fontSize: 15,
  },
  menuItemIcon: {
    width: 20,
    height: 20,
    resizeMode: 'contain',
    marginLeft: 8,
  },

  gridRow: {
    justifyContent: 'space-between',
  },
  gridItem: {
    flex: 1,
    marginVertical: 10,
    marginHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridIcon: {
    width: 60,
    height: 60,
    resizeMode: 'contain',
  },

  markerWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerBg: {
    resizeMode: 'contain',
  },
  markerFg: {
    position: 'absolute',
    width: 40,
    height: 40,
    resizeMode: 'contain',
  },
});
