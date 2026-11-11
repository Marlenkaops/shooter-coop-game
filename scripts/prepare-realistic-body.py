"""Run with Blender --factory-startup --background --disable-autoexec SOURCE.blend --python this_file -- OUTPUT."""
import bpy
import hashlib
import json
import math
import pathlib
import struct
import sys

output = pathlib.Path(sys.argv[sys.argv.index("--") + 1]).resolve()
with pathlib.Path(bpy.data.filepath).open("rb") as source_file:
    source_hash = hashlib.file_digest(source_file, "sha256").hexdigest()
if source_hash != "8d0adaf7fe998272dd980697ec450eed1796fe156cdd6dbda55215d9d22ef766":
    raise RuntimeError("Use the original CC0 3D male file linked by the creator's publication")
body = bpy.data.objects.get("body")
armature = bpy.data.objects.get("Armature")
if not body or body.type != "MESH" or not armature or armature.type != "ARMATURE":
    raise RuntimeError("Expected the creator's CC0 3D male body and armature")
armature.data.pose_position = "REST"
for modifier in body.modifiers:
    if modifier.type == "ARMATURE":
        modifier.show_viewport = modifier.show_render = False
bpy.context.view_layer.update()

aliases = {
    "body_lower": "pelvis", "body_mid": "spine_02", "body_upper": "spine_03",
    "neck": "neck_01", "head": "Head",
}
for original_side, side in [("L", "l"), ("R", "r")]:
    for original, standard in [
        ("collar", "clavicle"), ("arm_upper", "upperarm"), ("arm_lower", "lowerarm"),
        ("palm", "hand"), ("leg_upper", "thigh"), ("leg_lower", "calf"), ("foot", "foot"),
    ]:
        aliases[f"{original}.{original_side}"] = f"{standard}_{side}"
    for digit, finger in [(1, "thumb"), (2, "index"), (3, "middle"), (4, "ring"), (5, "pinky")]:
        aliases[f"finger_{digit}.{original_side}"] = f"{finger}_01_{side}"
        aliases[f"finger_{digit}b.{original_side}"] = f"{finger}_02_{side}"
if set(aliases) != {bone.name for bone in armature.data.bones}:
    raise RuntimeError("Unexpected source skeleton; refusing to guess a joint mapping")

rest_vertices = [body.matrix_world @ vertex.co for vertex in body.data.vertices]
floor = min(position.z for position in rest_vertices)
head_group = body.vertex_groups["head"].index
head_vertices = [
    position for vertex, position in zip(body.data.vertices, rest_vertices)
    if any(group.group == head_group and group.weight > .9 for group in vertex.groups)
]
if not head_vertices:
    raise RuntimeError("Missing weighted head anatomy")
head_center = [(min(p[axis] for p in head_vertices) + max(p[axis] for p in head_vertices)) / 2 for axis in range(3)]
scale = 1.9 / (head_center[2] - floor)
left_foot = armature.matrix_world @ armature.data.bones["foot.L"].head_local
right_foot = armature.matrix_world @ armature.data.bones["foot.R"].head_local
origin = (left_foot + right_foot) / 2

def position(value):
    return [-(value[0] - origin.x) * scale, (value[2] - floor) * scale, -(value[1] - origin.y) * scale]

source_bones = list(armature.data.bones)
bone_indices = {bone.name: index for index, bone in enumerate(source_bones)}
bones = [{
    "name": aliases[bone.name],
    "parent": bone_indices[bone.parent.name] if bone.parent else -1,
    "position": position(armature.matrix_world @ bone.head_local),
} for bone in source_bones]
if any(bone["parent"] >= index for index, bone in enumerate(bones)):
    raise RuntimeError("Source skeleton is not parent-ordered")

manifest = {
    "version": 1, "source": "Drummyfish 3D male (CC0)", "assetId": "drummyfish-3d-male", "sourceSha256": source_hash,
    "bones": bones, "headCenter": position(head_center), "meshes": [], "distantMeshes": [],
}
binary = bytearray()

def store(values, data_type):
    if not values or any(not math.isfinite(value) for value in values):
        raise RuntimeError("Empty or non-finite prepared geometry")
    while len(binary) % 4:
        binary.append(0)
    record = {"offset": len(binary), "length": len(values), "type": data_type}
    binary.extend(struct.pack("<" + ("f" if data_type == "Float32Array" else "H") * len(values), *values))
    return record

def prepare(level):
    obj = body.copy()
    obj.data = body.data.copy()
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    # The game animates the skeleton, not the source's optional facial morphs.
    if obj.data.shape_keys:
        basis = [vertex.co.copy() for vertex in obj.data.shape_keys.key_blocks[0].data]
        obj.shape_key_clear()
        for vertex, value in zip(obj.data.vertices, basis):
            vertex.co = value
    subdivision = next((m for m in obj.modifiers if m.type == "SUBSURF"), None)
    if not subdivision:
        raise RuntimeError("Missing creator-authored subdivision surface")
    if level:
        subdivision.levels = level
        bpy.ops.object.modifier_apply(modifier=subdivision.name)
    else:
        obj.modifiers.remove(subdivision)
    mesh = obj.data
    mesh.update()
    mesh.calc_loop_triangles()
    normal_matrix = obj.matrix_world.to_3x3().inverted().transposed()
    uv_layer = mesh.uv_layers.active
    if not uv_layer:
        raise RuntimeError("Missing creator-authored texture coordinates")
    fields = {name: [] for name in ["position", "normal", "uv", "skinIndex", "skinWeight", "index"]}
    remap = {}
    groups = {group.index: bone_indices[group.name] for group in obj.vertex_groups}
    for triangle in mesh.loop_triangles:
        # Mapping Blender's axes while reflecting X reverses triangle winding.
        for loop_index in [triangle.loops[0], triangle.loops[2], triangle.loops[1]]:
            loop = mesh.loops[loop_index]
            uv = uv_layer.data[loop_index].uv
            normal = (normal_matrix @ mesh.corner_normals[loop_index].vector).normalized()
            key = (loop.vertex_index, *[round(value, 7) for value in [*uv, *normal]])
            if key not in remap:
                remap[key] = len(remap)
                vertex = mesh.vertices[loop.vertex_index]
                fields["position"].extend(position(obj.matrix_world @ vertex.co))
                fields["normal"].extend([-normal.x, normal.z, -normal.y])
                fields["uv"].extend(uv)
                weights = sorted(
                    [(group.weight, groups[group.group]) for group in vertex.groups if group.weight > 0],
                    reverse=True,
                )[:4]
                total = sum(weight for weight, _ in weights)
                if total <= 0:
                    raise RuntimeError("Unweighted source vertex")
                fields["skinIndex"].extend([joint for _, joint in weights] + [0] * (4 - len(weights)))
                fields["skinWeight"].extend([weight / total for weight, _ in weights] + [0] * (4 - len(weights)))
            fields["index"].append(remap[key])
    if len(remap) >= 65536:
        raise RuntimeError("Prepared model exceeds the 16-bit mesh budget")
    record = {"name": "Body", "fields": {
        name: store(values, "Uint16Array" if name in {"skinIndex", "index"} else "Float32Array")
        for name, values in fields.items()
    }}
    print(f"Prepared detail {level}: {len(remap)} vertices, {len(fields['index']) // 3} triangles")
    bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.meshes.remove(mesh)
    return record

manifest["meshes"].append(prepare(1))
manifest["distantMeshes"].append(prepare(0))
output.mkdir(parents=True, exist_ok=True)
(output / "tactical-body.bin").write_bytes(binary)
(output / "tactical-body.json").write_text(json.dumps(manifest, separators=(",", ":")) + "\n")
image = bpy.data.images.get("char_texture.png")
if not image or not image.packed_file or list(image.size) != [1024, 1024]:
    raise RuntimeError("Missing the creator's packed 1024px skin texture")
image.file_format = "JPEG"
image.filepath_raw = str(output / "tactical-skin.jpg")
image.save()
print(f"Prepared licensed realistic base: {len(binary)} bytes, {len(bones)} joints; visible head center 1.9m.")
