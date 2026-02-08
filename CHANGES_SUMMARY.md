# File Manager MCP Server - Changes Summary

## 1. Changed Default Documents Directory (Line 18)

```python
# Before
DOCUMENTS_DIR = Path.home() / "Documents"

# After
DOCUMENTS_DIR = Path.home() / "OneDrive" / "Documents"
```

## 2. Added `shutil` Import (Line 5)

```python
import shutil
```

Required for the `copy_file` tool.

---

## 3. New Tools Added

### 3.1 `create_directory`

Creates a new folder in Documents, Downloads, or any specified path.

**Tool Definition:**
```python
Tool(
    name="create_directory",
    description="Create a new directory/folder. Can create in Documents, Downloads, or specify a full path.",
    inputSchema={
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "Name of the folder to create (e.g., 'MyProject', 'Photos/Vacation2024')",
            },
            "location": {
                "type": "string",
                "description": "Optional: Where to create the folder. Use 'documents' (default), 'downloads', or a full path.",
            },
        },
        "required": ["name"],
    },
),
```

**Handler:**
```python
async def handle_create_directory(self, args: dict) -> list[TextContent]:
    name = args.get("name")
    if not name:
        raise ValueError("name is required")

    location = args.get("location", "documents").lower()

    # Determine base directory
    if location == "documents":
        base_dir = DOCUMENTS_DIR
    elif location == "downloads":
        base_dir = DOWNLOADS_DIR
    else:
        base_dir = Path(location).resolve()

    # Create the full path
    new_dir = base_dir / name

    if new_dir.exists():
        return [
            TextContent(
                type="text",
                text=f"Directory already exists: {new_dir}",
            )
        ]

    new_dir.mkdir(parents=True, exist_ok=True)

    return [
        TextContent(
            type="text",
            text=f"Successfully created directory: {new_dir}",
        )
    ]
```

---

### 3.2 `move_latest_svg`

Moves only the most recent SVG file (not all SVGs).

**Tool Definition:**
```python
Tool(
    name="move_latest_svg",
    description="Move only the most recently downloaded/modified SVG file from Downloads to a folder in Documents",
    inputSchema={
        "type": "object",
        "properties": {
            "destination_folder": {
                "type": "string",
                "description": "Subfolder in Documents where the SVG file should go (e.g., 'DoorHanger', 'Icons')",
            },
            "source": {
                "type": "string",
                "description": "Optional: Source directory to search (defaults to Downloads)",
            },
        },
        "required": ["destination_folder"],
    },
),
```

**Handler:**
```python
async def handle_move_latest_svg(self, args: dict) -> list[TextContent]:
    destination_folder = args.get("destination_folder")
    if not destination_folder:
        raise ValueError("destination_folder is required")

    source_dir = Path(args.get("source", DOWNLOADS_DIR)).resolve()

    if not source_dir.exists():
        raise ValueError(f"Source directory not found: {source_dir}")

    # Find all SVG files
    svg_files = await self.find_files(source_dir, ".svg")

    if not svg_files:
        return [
            TextContent(
                type="text", text=f"No SVG files found in {source_dir}"
            )
        ]

    # Get the most recent SVG file by modification time
    latest_svg = max(svg_files, key=lambda f: f.stat().st_mtime)

    # Create destination folder in Documents
    dest_dir = DOCUMENTS_DIR / destination_folder
    dest_dir.mkdir(parents=True, exist_ok=True)

    # Determine destination path
    dest_path = dest_dir / latest_svg.name

    # Handle duplicate filenames
    final_dest_path = dest_path
    counter = 1
    while final_dest_path.exists():
        stem = latest_svg.stem
        suffix = latest_svg.suffix
        final_dest_path = dest_dir / f"{stem}_{counter}{suffix}"
        counter += 1

    # Move the file
    latest_svg.rename(final_dest_path)

    return [
        TextContent(
            type="text",
            text=f"Successfully moved the latest SVG file to {final_dest_path}\n\nFile: {latest_svg.name}",
        )
    ]
```

---

### 3.3 `copy_file`

Copies any named file from Downloads to Documents.

**Tool Definition:**
```python
Tool(
    name="copy_file",
    description="Copy a specific file by name from Downloads to Documents or another location",
    inputSchema={
        "type": "object",
        "properties": {
            "filename": {
                "type": "string",
                "description": "Name of the file to copy (e.g., 'report.pdf', 'image.png')",
            },
            "destination_folder": {
                "type": "string",
                "description": "Optional: Subfolder in Documents where the file should go. If not specified, copies to Documents root.",
            },
            "source": {
                "type": "string",
                "description": "Optional: Source directory (defaults to Downloads). Can be 'downloads', 'documents', or a full path.",
            },
        },
        "required": ["filename"],
    },
),
```

**Handler:**
```python
async def handle_copy_file(self, args: dict) -> list[TextContent]:
    filename = args.get("filename")
    if not filename:
        raise ValueError("filename is required")

    # Determine source directory
    source_arg = args.get("source", "downloads").lower()
    if source_arg == "downloads":
        source_dir = DOWNLOADS_DIR
    elif source_arg == "documents":
        source_dir = DOCUMENTS_DIR
    else:
        source_dir = Path(source_arg).resolve()

    source_file = source_dir / filename

    if not source_file.exists():
        # Try to find the file recursively if not found at top level
        found_files = list(source_dir.rglob(filename))
        if found_files:
            source_file = found_files[0]
        else:
            raise ValueError(f"File not found: {filename} in {source_dir}")

    # Determine destination
    dest_folder = args.get("destination_folder", "")
    if dest_folder:
        dest_dir = DOCUMENTS_DIR / dest_folder
    else:
        dest_dir = DOCUMENTS_DIR

    dest_dir.mkdir(parents=True, exist_ok=True)

    # Determine destination path
    dest_path = dest_dir / source_file.name

    # Handle duplicate filenames
    final_dest_path = dest_path
    counter = 1
    while final_dest_path.exists():
        stem = source_file.stem
        suffix = source_file.suffix
        final_dest_path = dest_dir / f"{stem}_{counter}{suffix}"
        counter += 1

    # Copy the file
    shutil.copy2(source_file, final_dest_path)

    return [
        TextContent(
            type="text",
            text=f"Successfully copied {source_file.name} to {final_dest_path}",
        )
    ]
```

---

### 3.4 `move_file`

Moves any named file (removes from original location).

**Tool Definition:**
```python
Tool(
    name="move_file",
    description="Move a specific file by name from Downloads to Documents or another location (removes from original location)",
    inputSchema={
        "type": "object",
        "properties": {
            "filename": {
                "type": "string",
                "description": "Name of the file to move (e.g., 'report.pdf', 'image.png')",
            },
            "destination_folder": {
                "type": "string",
                "description": "Optional: Subfolder in Documents where the file should go. If not specified, moves to Documents root.",
            },
            "source": {
                "type": "string",
                "description": "Optional: Source directory (defaults to Downloads). Can be 'downloads', 'documents', or a full path.",
            },
        },
        "required": ["filename"],
    },
),
```

**Handler:**
```python
async def handle_move_file(self, args: dict) -> list[TextContent]:
    filename = args.get("filename")
    if not filename:
        raise ValueError("filename is required")

    # Determine source directory
    source_arg = args.get("source", "downloads").lower()
    if source_arg == "downloads":
        source_dir = DOWNLOADS_DIR
    elif source_arg == "documents":
        source_dir = DOCUMENTS_DIR
    else:
        source_dir = Path(source_arg).resolve()

    source_file = source_dir / filename

    if not source_file.exists():
        # Try to find the file recursively if not found at top level
        found_files = list(source_dir.rglob(filename))
        if found_files:
            source_file = found_files[0]
        else:
            raise ValueError(f"File not found: {filename} in {source_dir}")

    # Determine destination
    dest_folder = args.get("destination_folder", "")
    if dest_folder:
        dest_dir = DOCUMENTS_DIR / dest_folder
    else:
        dest_dir = DOCUMENTS_DIR

    dest_dir.mkdir(parents=True, exist_ok=True)

    # Determine destination path
    dest_path = dest_dir / source_file.name

    # Handle duplicate filenames
    final_dest_path = dest_path
    counter = 1
    while final_dest_path.exists():
        stem = source_file.stem
        suffix = source_file.suffix
        final_dest_path = dest_dir / f"{stem}_{counter}{suffix}"
        counter += 1

    # Move the file
    source_file.rename(final_dest_path)

    return [
        TextContent(
            type="text",
            text=f"Successfully moved {filename} to {final_dest_path}",
        )
    ]
```

---

### 3.5 `list_files`

Lists files in any directory, sorted by most recent.

**Tool Definition:**
```python
Tool(
    name="list_files",
    description="List files in a directory, sorted by most recent first. Can filter by file type.",
    inputSchema={
        "type": "object",
        "properties": {
            "directory": {
                "type": "string",
                "description": "Optional: Directory to list (defaults to Downloads). Can be 'downloads', 'documents', a subfolder like 'documents/Projects', or a full path.",
            },
            "file_type": {
                "type": "string",
                "description": "Optional: Filter by file extension (e.g., 'pdf', 'svg', 'png')",
            },
            "limit": {
                "type": "number",
                "description": "Optional: Maximum number of files to show (default: 20)",
            },
        },
    },
),
```

**Handler:**
```python
async def handle_list_files(self, args: dict) -> list[TextContent]:
    limit = args.get("limit", 20)
    file_type = args.get("file_type", "").lower().lstrip(".")

    # Determine directory
    dir_arg = args.get("directory", "downloads").lower()
    if dir_arg == "downloads":
        search_dir = DOWNLOADS_DIR
    elif dir_arg == "documents":
        search_dir = DOCUMENTS_DIR
    elif dir_arg.startswith("documents/") or dir_arg.startswith("documents\\"):
        subfolder = dir_arg.split("/", 1)[-1].split("\\", 1)[-1]
        search_dir = DOCUMENTS_DIR / subfolder
    elif dir_arg.startswith("downloads/") or dir_arg.startswith("downloads\\"):
        subfolder = dir_arg.split("/", 1)[-1].split("\\", 1)[-1]
        search_dir = DOWNLOADS_DIR / subfolder
    else:
        search_dir = Path(dir_arg).resolve()

    if not search_dir.exists():
        raise ValueError(f"Directory not found: {search_dir}")

    # Get file details
    file_details = []
    for file in search_dir.iterdir():
        if file.is_file():
            try:
                stats = file.stat()
                extension = file.suffix.lower().lstrip(".")
                file_details.append({
                    "name": file.name,
                    "size": stats.st_size,
                    "modified": datetime.fromtimestamp(stats.st_mtime),
                    "extension": extension,
                })
            except Exception:
                pass

    # Apply file type filter
    if file_type:
        file_details = [f for f in file_details if f["extension"] == file_type]

    if not file_details:
        type_msg = f" of type '.{file_type}'" if file_type else ""
        return [
            TextContent(
                type="text", text=f"No files{type_msg} found in {search_dir}"
            )
        ]

    # Sort by modified date (newest first)
    file_details.sort(key=lambda x: x["modified"], reverse=True)

    # Limit results
    limited_files = file_details[:limit]

    file_list = []
    for index, file in enumerate(limited_files):
        size = file["size"]
        if size > 1024 * 1024:
            display_size = f"{size / (1024 * 1024):.2f} MB"
        elif size > 1024:
            display_size = f"{size / 1024:.2f} KB"
        else:
            display_size = f"{size} bytes"

        date_str = file["modified"].strftime("%m/%d/%Y, %I:%M %p")
        badge = " [LATEST]" if index == 0 else ""
        file_list.append(f"{file['name']}{badge}\n  Size: {display_size} | Modified: {date_str}")

    type_msg = f" (filtered to .{file_type} files)" if file_type else ""
    return [
        TextContent(
            type="text",
            text=f"Files in {search_dir}{type_msg}\nShowing {len(limited_files)} of {len(file_details)} (sorted by most recent):\n\n" + "\n\n".join(file_list),
        )
    ]
```

---

## 4. Tool Routing

Add these to the `call_tool` function's if/elif chain:

```python
elif name == "create_directory":
    return await self.handle_create_directory(arguments)
elif name == "move_latest_svg":
    return await self.handle_move_latest_svg(arguments)
elif name == "copy_file":
    return await self.handle_copy_file(arguments)
elif name == "move_file":
    return await self.handle_move_file(arguments)
elif name == "list_files":
    return await self.handle_list_files(arguments)
```

---

## Quick Reference - Example User Requests

| Tool | Example Request |
|------|-----------------|
| `create_directory` | "Create a folder called CraftProjects" |
| `move_latest_svg` | "Move the latest SVG to DoorHanger" |
| `copy_file` | "Copy report.pdf to Projects" |
| `move_file` | "Move image.png to Photos" |
| `list_files` | "Show me files in documents/DoorHanger" |
