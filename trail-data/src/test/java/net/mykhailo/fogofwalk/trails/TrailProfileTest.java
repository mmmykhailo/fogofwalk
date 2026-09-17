package net.mykhailo.fogofwalk.trails;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.api.Test;

class TrailProfileTest {
  @Test
  void rejectsMutablePlanetAndWrongSchemaArguments() {
    String checksum = "0".repeat(64);
    String[] args = {
      "--osm-path=/data/planet-latest.osm.pbf",
      "--osm-source-url=https://planet.openstreetmap.org/pbf/planet.osm.pbf",
      "--osm-source-checksum=" + checksum,
      "--output=/tmp/trails.pmtiles",
      "--report=/tmp/trails.json",
      "--schema-version=1",
      "--minzoom=12",
      "--maxzoom=12",
    };
    assertThrows(IllegalArgumentException.class, () -> TrailProfile.parseBuildInputs(args));
  }

  @Test
  void acceptsOnlyCredentialFreeSourceUrlsAndChecksums() {
    assertEquals("a".repeat(64), TrailProfile.normalizeSha256("sha256:" + "a".repeat(64)));
    assertThrows(IllegalArgumentException.class, () -> TrailProfile.normalizeSha256("not-a-checksum"));
  }

  @Test
  void exposesTheArchiveContract() {
    assertEquals(1, TrailProfile.SCHEMA_VERSION);
    assertEquals(12, TrailProfile.MIN_ZOOM);
    assertEquals(12, TrailProfile.MAX_ZOOM);
    assertEquals("trails", TrailProfile.SOURCE_LAYER);
  }
}
