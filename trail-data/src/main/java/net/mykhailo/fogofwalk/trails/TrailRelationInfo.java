package net.mykhailo.fogofwalk.trails;

import com.onthegomap.planetiler.reader.osm.OsmRelationInfo;

/** Compact relation data retained by Planetiler between its OSM passes. */
public record TrailRelationInfo(
  long id,
  TrailClassifier.Kind kind,
  int networkRank,
  String color,
  boolean superRoute,
  boolean unsupportedColor
) implements OsmRelationInfo {}
