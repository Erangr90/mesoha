import React, { useEffect, useRef, useState } from 'react';
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

const MAPBOX_TOKEN =
  'pk.eyJ1IjoiZXJhbmdyOTAiLCJhIjoiY21kYmJpdTNoMDRyZTJxczIyYTU3NHFxNiJ9.VjCGEFeXxnYsuZ8eHARFZw';

Mapbox.setAccessToken(MAPBOX_TOKEN);

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

interface Marker {
  id: string;
  coordinates: [number, number];
  icon: ImageSourcePropType;
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
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [modalVisible, setModalVisible] = useState(false);

  // Search state
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeoFeature[]>([]);
  const [loading, setLoading] = useState(false);
  const [openList, setOpenList] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [menuOpen, setMenuOpen] = useState(false);

  const [mapReady, setMapReady] = useState(false);
  const lastUserCoordRef = useRef<[number, number] | null>(null);

  // Camera ref (keep it wide to avoid SDK type friction)
  const cameraRef = useRef<any>(null);

  const getUserLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const userLocation = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      const { longitude, latitude } = userLocation.coords;
      setLocation([longitude, latitude]);
    } catch (error) {
      console.error('Error getting user location:', error);
    }
  };

  useEffect(() => {
    getUserLocation();
  }, []);

  const centerToMe = async () => {
    let coord = lastUserCoordRef.current || location;

    if (!coord) {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          console.warn('centerToMe: permission not granted');
          return;
        }
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        coord = [pos.coords.longitude, pos.coords.latitude];
        lastUserCoordRef.current = coord;
        setLocation(coord);
      } catch (err) {
        console.warn('centerToMe: failed to fetch GPS', err);
        return;
      }
    }

    if (!mapReady) {
      console.warn('centerToMe: map not ready yet');
      return;
    }
    if (!cameraRef.current) {
      console.warn('centerToMe: camera ref missing');
      return;
    }

    // Prefer setCamera (atomic); otherwise fly then zoom after a tick
    if (cameraRef.current.setCamera) {
      cameraRef.current.setCamera({
        centerCoordinate: coord,
        zoomLevel: 14,
        animationMode: 'flyTo',
        animationDuration: 800,
      });
    } else {
      cameraRef.current.flyTo?.(coord, 800);
      requestAnimationFrame(() => cameraRef.current?.zoomTo?.(14, 600));
    }
  };

  const handleAddEvent = () => setModalVisible(true);
  const handleSelectEvent = async (eventType: EventType) => {
    // Prefer the live coordinate from <UserLocation />, else fall back to last known / fresh fetch
    let coord = lastUserCoordRef.current || location;

    if (!coord) {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('שגיאה', 'אין הרשאת מיקום');
          return;
        }
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        coord = [pos.coords.longitude, pos.coords.latitude];
        lastUserCoordRef.current = coord;
        setLocation(coord);
      } catch (e) {
        Alert.alert('שגיאה', 'לא ניתן לקבל מיקום נוכחי');
        return;
      }
    }

    // Add marker at user's coordinate
    setMarkers((prev) => [
      ...prev,
      { id: Date.now().toString(), coordinates: coord!, icon: CMENU_SRC[eventType] },
    ]);

    // Optionally recentre camera to the dropped marker
    if (mapReady && cameraRef.current) {
      if (cameraRef.current.setCamera) {
        cameraRef.current.setCamera({
          centerCoordinate: coord!,
          zoomLevel: 15,
          animationMode: 'flyTo',
          animationDuration: 700,
        });
      } else {
        cameraRef.current.flyTo?.(coord!, 700);
        requestAnimationFrame(() => cameraRef.current?.zoomTo?.(15, 500));
      }
    }

    setSelectedEvent(null);
    setModalVisible(false);
  };

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
      const url =
        `https://api.mapbox.com/geocoding/v5/mapbox.places/` +
        `${encodeURIComponent(trimmed)}.json` +
        `?access_token=${MAPBOX_TOKEN}` +
        `&types=place,locality,region` +
        `&limit=7` +
        `&language=he`;
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
    const coord = feature.center as [number, number];

    // UI cleanup
    setOpenList(false);
    setQuery(feature.text);
    Keyboard.dismiss();

    // Keep for your own state if you need it later (not used by Camera anymore)
    setLocation(coord);

    // Move camera atomically, just like centerToMe
    const move = () => {
      if (!cameraRef.current) return;
      if (cameraRef.current.setCamera) {
        cameraRef.current.setCamera({
          centerCoordinate: coord,
          zoomLevel: 11,
          animationMode: 'flyTo',
          animationDuration: 900,
        });
      } else {
        cameraRef.current.flyTo?.(coord, 900);
        requestAnimationFrame(() => cameraRef.current?.zoomTo?.(11, 700));
      }
    };

    if (mapReady) {
      move();
    } else {
      // if user searches immediately at startup, wait for style load
      const id = setTimeout(() => move(), 100);
      // (optional) clearTimeout on unmount if you add a cleanup
    }
  };

  return (
    <View style={{ flex: 1 }}>
      {/* Search bar + menu */}
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
        styleURL="mapbox://styles/erangr90/cmdeeuopg003g01qy73xgavkp"
        localizeLabels
        onTouchStart={() => setOpenList(false)}
        onDidFinishLoadingStyle={() => setMapReady(true)}>
        {location && (
          <Camera
            ref={cameraRef}
            defaultSettings={{ centerCoordinate: location, zoomLevel: 14 }} // ✅ initial only
            animationMode="flyTo"
            animationDuration={1000}
          />
        )}

        {/* Show user's current location (blue puck) */}
        <UserLocation
          visible
          androidRenderMode="compass"
          showsUserHeadingIndicator
          onUpdate={(loc) => {
            // Keep the most recent GPS point in a ref (no re-render)
            if (loc?.coords) {
              lastUserCoordRef.current = [loc.coords.longitude, loc.coords.latitude];
            }
          }}
        />

        {markers.map((marker) => (
          <MarkerView key={marker.id} id={marker.id} coordinate={marker.coordinates}>
            <TouchableOpacity onLongPress={() => handleLongPressMarker(marker.id)}>
              <Image
                source={marker.icon}
                style={{ width: 28, height: 28, resizeMode: 'contain' }}
              />
            </TouchableOpacity>
          </MarkerView>
        ))}
      </MapView>

      {/* Add event */}
      <TouchableOpacity style={styles.button} onPress={handleAddEvent}>
        <Text style={styles.buttonText}>➕</Text>
      </TouchableOpacity>

      {/* Optional: quick recenter button */}
      <TouchableOpacity
        style={styles.gpsBtn}
        onPress={() => {
          centerToMe();
        }}>
        <Text style={styles.buttonText}>📍</Text>
      </TouchableOpacity>

      {/* Stress button (kept from your version) */}
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
            {Object.entries(CMENU_SRC).map(([key, src]) => (
              <TouchableOpacity
                key={key}
                style={styles.modalItemRow}
                onPress={() => handleSelectEvent(key as EventType)}>
                <Text style={styles.modalItemText}>{key}</Text>
                <Image source={src} style={styles.modalItemIcon} />
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
    paddingLeft: 40, // room for the icon
    paddingRight: 44, // room for spinner on the right
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
    zIndex: 999, // keep it above the search input
    transform: [{ translateX: -130 }], // shift left so it doesn't get cut
    ...SHADOW,
  },
  menuItem: {
    flexDirection: 'row', // put text and image in a row
    justifyContent: 'space-between', // push them apart
    alignItems: 'center', // vertical centering
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
  modalItemRow: {
    flexDirection: 'row', // row layout
    justifyContent: 'space-between', // text on left, image on right
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
  },
  modalItemIcon: {
    width: 22,
    height: 22,
    resizeMode: 'contain',
    marginLeft: 8,
  },
});
