#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";
import { createWriteStream } from "fs";
import { promisify } from "util";
import { pipeline } from "stream";
import AdmZip from "adm-zip";
import os from "os";

const pipelineAsync = promisify(pipeline);

// Get user's Downloads and Documents directories
const DOWNLOADS_DIR = path.join(os.homedir(), "Downloads");
const DOCUMENTS_DIR = path.join(os.homedir(), String.raw`OneDrive\Documents`);

class FileManagerServer {
    constructor() {
        this.server = new Server(
            {
                name: "file-manager",
                version: "1.0.0",
            },
            {
                capabilities: {
                    tools: {},
                },
            }
        );

        this.setupHandlers();
        this.setupErrorHandling();
    }

    setupErrorHandling() {
        this.server.onerror = (error) => {
            console.error("[MCP Error]", error);
        };

        process.on("SIGINT", async () => {
            await this.server.close();
            process.exit(0);
        });
    }

    setupHandlers() {
        // List available tools
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [
                {
                    name: "unzip_file",
                    description:
                        "Unzip a file from the Downloads directory. You can specify where to extract it, or it will extract to Downloads by default.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            filename: {
                                type: "string",
                                description: "Name of the zip file in Downloads (e.g., 'archive.zip')",
                            },
                            destination: {
                                type: "string",
                                description: "Optional: Where to extract files (defaults to Downloads). Use 'downloads' or 'documents' or a specific path.",
                            },
                        },
                        required: ["filename"],
                    },
                },
                {
                    name: "move_svg_files",
                    description:
                        "Find and move all SVG files from Downloads to Documents directory. Can move to a specific subfolder in Documents (e.g., 'DoorHanger', 'Icons', 'Graphics').",
                    inputSchema: {
                        type: "object",
                        properties: {
                            source: {
                                type: "string",
                                description: "Optional: Source directory to search for SVG files (defaults to Downloads). Can be a path relative to Downloads if unzipping created a subfolder.",
                            },
                            subfolder: {
                                type: "string",
                                description: "Optional: Subfolder name in Documents where SVG files should be moved (e.g., 'DoorHanger', 'Projects/Icons'). Will be created if it doesn't exist.",
                            },
                        },
                    },
                },
                {
                    name: "list_zip_files",
                    description: "List all zip files in the Downloads directory, sorted by date (newest first)",
                    inputSchema: {
                        type: "object",
                        properties: {
                            limit: {
                                type: "number",
                                description: "Optional: Maximum number of files to show (default: 10)",
                            },
                        },
                    },
                },
                {
                    name: "list_recent_downloads",
                    description: "Show the most recently downloaded files in the Downloads directory",
                    inputSchema: {
                        type: "object",
                        properties: {
                            limit: {
                                type: "number",
                                description: "Optional: Number of recent files to show (default: 10)",
                            },
                            file_type: {
                                type: "string",
                                description: "Optional: Filter by file extension (e.g., 'zip', 'pdf', 'svg')",
                            },
                        },
                    },
                },
                {
                    name: "unzip_latest",
                    description: "Unzip the most recently downloaded zip file from Downloads",
                    inputSchema: {
                        type: "object",
                        properties: {
                            destination: {
                                type: "string",
                                description: "Optional: Where to extract files (defaults to Downloads). Use 'downloads' or 'documents' or a specific path.",
                            },
                        },
                    },
                },
                {
                    name: "unzip_latest_and_move_svgs",
                    description: "Unzip the most recently downloaded zip file and move all SVG files to a specified folder in Documents",
                    inputSchema: {
                        type: "object",
                        properties: {
                            destination_folder: {
                                type: "string",
                                description: "Subfolder in Documents where SVG files should go (e.g., 'DoorHanger', 'Icons')",
                            },
                        },
                        required: ["destination_folder"],
                    },
                },
                {
                    name: "list_svg_files",
                    description: "List all SVG files in Downloads or a specified directory",
                    inputSchema: {
                        type: "object",
                        properties: {
                            directory: {
                                type: "string",
                                description: "Optional: Directory to search (defaults to Downloads)",
                            },
                        },
                    },
                },
                {
                    name: "unzip_and_move_svgs",
                    description:
                        "Combined operation: Unzip a file and then move all SVG files from the extracted folder to a specified location in Documents. Perfect for 'unzip project.zip and move SVGs to DoorHanger' requests.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            filename: {
                                type: "string",
                                description: "Name of the zip file in Downloads (e.g., 'project.zip')",
                            },
                            destination_folder: {
                                type: "string",
                                description: "Subfolder in Documents where SVG files should go (e.g., 'DoorHanger', 'Icons')",
                            },
                        },
                        required: ["filename", "destination_folder"],
                    },
                },
                {
                    name: "create_directory",
                    description: "Create a new directory/folder. Can create in Documents, Downloads, or specify a full path.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            name: {
                                type: "string",
                                description: "Name of the folder to create (e.g., 'MyProject', 'Photos/Vacation2024')",
                            },
                            location: {
                                type: "string",
                                description: "Optional: Where to create the folder. Use 'documents' (default), 'downloads', or a full path.",
                            },
                        },
                        required: ["name"],
                    },
                },
                {
                    name: "move_latest_svg",
                    description: "Move only the most recently downloaded/modified SVG file from Downloads to a folder in Documents",
                    inputSchema: {
                        type: "object",
                        properties: {
                            destination_folder: {
                                type: "string",
                                description: "Subfolder in Documents where the SVG file should go (e.g., 'DoorHanger', 'Icons')",
                            },
                            source: {
                                type: "string",
                                description: "Optional: Source directory to search (defaults to Downloads)",
                            },
                        },
                        required: ["destination_folder"],
                    },
                },
                {
                    name: "copy_file",
                    description: "Copy a specific file by name from Downloads to Documents or another location",
                    inputSchema: {
                        type: "object",
                        properties: {
                            filename: {
                                type: "string",
                                description: "Name of the file to copy (e.g., 'report.pdf', 'image.png')",
                            },
                            destination_folder: {
                                type: "string",
                                description: "Optional: Subfolder in Documents where the file should go. If not specified, copies to Documents root.",
                            },
                            source: {
                                type: "string",
                                description: "Optional: Source directory (defaults to Downloads). Can be 'downloads', 'documents', or a full path.",
                            },
                        },
                        required: ["filename"],
                    },
                },
                {
                    name: "move_file",
                    description: "Move a specific file by name from Downloads to Documents or another location (removes from original location)",
                    inputSchema: {
                        type: "object",
                        properties: {
                            filename: {
                                type: "string",
                                description: "Name of the file to move (e.g., 'report.pdf', 'image.png')",
                            },
                            destination_folder: {
                                type: "string",
                                description: "Optional: Subfolder in Documents where the file should go. If not specified, moves to Documents root.",
                            },
                            source: {
                                type: "string",
                                description: "Optional: Source directory (defaults to Downloads). Can be 'downloads', 'documents', or a full path.",
                            },
                        },
                        required: ["filename"],
                    },
                },
                {
                    name: "list_files",
                    description: "List files in a directory, sorted by most recent first. Can filter by file type.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            directory: {
                                type: "string",
                                description: "Optional: Directory to list (defaults to Downloads). Can be 'downloads', 'documents', a subfolder like 'documents/Projects', or a full path.",
                            },
                            file_type: {
                                type: "string",
                                description: "Optional: Filter by file extension (e.g., 'pdf', 'svg', 'png')",
                            },
                            limit: {
                                type: "number",
                                description: "Optional: Maximum number of files to show (default: 20)",
                            },
                        },
                    },
                },
            ],
        }));

        // Handle tool calls
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            try {
                switch (request.params.name) {
                    case "unzip_file":
                        return await this.handleUnzip(request.params.arguments);
                    case "move_svg_files":
                        return await this.handleMoveSvg(request.params.arguments);
                    case "list_zip_files":
                        return await this.handleListZip(request.params.arguments);
                    case "list_svg_files":
                        return await this.handleListSvg(request.params.arguments);
                    case "unzip_and_move_svgs":
                        return await this.handleUnzipAndMoveSvgs(request.params.arguments);
                    case "list_recent_downloads":
                        return await this.handleListRecentDownloads(request.params.arguments);
                    case "unzip_latest":
                        return await this.handleUnzipLatest(request.params.arguments);
                    case "unzip_latest_and_move_svgs":
                        return await this.handleUnzipLatestAndMoveSvgs(request.params.arguments);
                    case "create_directory":
                        return await this.handleCreateDirectory(request.params.arguments);
                    case "move_latest_svg":
                        return await this.handleMoveLatestSvg(request.params.arguments);
                    case "copy_file":
                        return await this.handleCopyFile(request.params.arguments);
                    case "move_file":
                        return await this.handleMoveFile(request.params.arguments);
                    case "list_files":
                        return await this.handleListFiles(request.params.arguments);
                    default:
                        throw new Error(`Unknown tool: ${request.params.name}`);
                }
            } catch (error) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Error: ${error.message}`,
                        },
                    ],
                    isError: true,
                };
            }
        });
    }

    async handleUnzip(args) {
        const filename = args.filename;
        if (!filename) {
            throw new Error("filename is required");
        }

        const zipPath = path.join(DOWNLOADS_DIR, filename);

        // Check if file exists
        try {
            await fs.access(zipPath);
        } catch {
            throw new Error(`Zip file not found: ${filename}`);
        }

        // Determine destination
        let destDir = DOWNLOADS_DIR;
        if (args.destination) {
            const dest = args.destination.toLowerCase();
            if (dest === "downloads") {
                destDir = DOWNLOADS_DIR;
            } else if (dest === "documents") {
                destDir = DOCUMENTS_DIR;
            } else {
                destDir = path.resolve(args.destination);
            }
        }

        // Extract zip
        const zip = new AdmZip(zipPath);
        const extractPath = path.join(destDir, path.basename(filename, ".zip"));

        await fs.mkdir(extractPath, { recursive: true });
        zip.extractAllTo(extractPath, true);

        const entries = zip.getEntries();
        const fileList = entries.map((entry) => entry.entryName).join("\n");

        return {
            content: [
                {
                    type: "text",
                    text: `Successfully unzipped ${filename} to ${extractPath}\n\nExtracted ${entries.length} files:\n${fileList}`,
                },
            ],
        };
    }

    async handleMoveSvg(args) {
        const sourceDir = args.source
            ? path.resolve(args.source)
            : DOWNLOADS_DIR;

        // Check if source exists
        try {
            await fs.access(sourceDir);
        } catch {
            throw new Error(`Source directory not found: ${sourceDir}`);
        }

        // Determine destination
        let destDir = DOCUMENTS_DIR;
        if (args.subfolder) {
            destDir = path.join(DOCUMENTS_DIR, args.subfolder);
            await fs.mkdir(destDir, { recursive: true });
        }

        // Find all SVG files recursively
        const svgFiles = await this.findFiles(sourceDir, ".svg");

        if (svgFiles.length === 0) {
            return {
                content: [
                    {
                        type: "text",
                        text: `No SVG files found in ${sourceDir}`,
                    },
                ],
            };
        }

        // Move each SVG file
        const movedFiles = [];
        for (const svgPath of svgFiles) {
            const filename = path.basename(svgPath);
            const destPath = path.join(destDir, filename);

            // Handle duplicate filenames
            let finalDestPath = destPath;
            let counter = 1;
            while (true) {
                try {
                    await fs.access(finalDestPath);
                    // File exists, try another name
                    const ext = path.extname(filename);
                    const base = path.basename(filename, ext);
                    finalDestPath = path.join(destDir, `${base}_${counter}${ext}`);
                    counter++;
                } catch {
                    // File doesn't exist, we can use this path
                    break;
                }
            }

            await fs.rename(svgPath, finalDestPath);
            movedFiles.push(path.basename(finalDestPath));
        }

        return {
            content: [
                {
                    type: "text",
                    text: `Successfully moved ${movedFiles.length} SVG file(s) from ${sourceDir} to ${destDir}\n\nMoved files:\n${movedFiles.join("\n")}`,
                },
            ],
        };
    }

    async handleListZip(args) {
        const limit = args?.limit || 10;
        const files = await fs.readdir(DOWNLOADS_DIR);
        const zipFiles = files.filter((f) => f.toLowerCase().endsWith(".zip"));

        if (zipFiles.length === 0) {
            return {
                content: [
                    {
                        type: "text",
                        text: `No zip files found in ${DOWNLOADS_DIR}`,
                    },
                ],
            };
        }

        // Get file details with timestamps
        const fileDetails = await Promise.all(
            zipFiles.map(async (file) => {
                const filePath = path.join(DOWNLOADS_DIR, file);
                const stats = await fs.stat(filePath);
                return {
                    name: file,
                    size: stats.size,
                    modified: stats.mtime,
                };
            })
        );

        // Sort by modified date (newest first)
        fileDetails.sort((a, b) => b.modified - a.modified);

        // Limit results
        const limitedFiles = fileDetails.slice(0, limit);

        const fileList = limitedFiles.map((file) => {
            const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
            const date = file.modified.toLocaleString();
            return `${file.name} (${sizeMB} MB) - ${date}`;
        });

        return {
            content: [
                {
                    type: "text",
                    text: `Found ${zipFiles.length} zip file(s) in Downloads (showing ${limitedFiles.length} most recent):\n\n${fileList.join("\n")}`,
                },
            ],
        };
    }

    async handleListSvg(args) {
        const searchDir = args.directory
            ? path.resolve(args.directory)
            : DOWNLOADS_DIR;

        try {
            await fs.access(searchDir);
        } catch {
            throw new Error(`Directory not found: ${searchDir}`);
        }

        const svgFiles = await this.findFiles(searchDir, ".svg");

        if (svgFiles.length === 0) {
            return {
                content: [
                    {
                        type: "text",
                        text: `No SVG files found in ${searchDir}`,
                    },
                ],
            };
        }

        const relativePaths = svgFiles.map((f) =>
            path.relative(searchDir, f)
        );

        return {
            content: [
                {
                    type: "text",
                    text: `Found ${svgFiles.length} SVG file(s) in ${searchDir}:\n\n${relativePaths.join("\n")}`,
                },
            ],
        };
    }

    async findFiles(dir, extension) {
        const results = [];

        async function walk(currentDir) {
            const entries = await fs.readdir(currentDir, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(currentDir, entry.name);

                if (entry.isDirectory()) {
                    await walk(fullPath);
                } else if (entry.isFile() && entry.name.toLowerCase().endsWith(extension)) {
                    results.push(fullPath);
                }
            }
        }

        await walk(dir);
        return results;
    }

    async handleUnzipAndMoveSvgs(args) {
        const filename = args.filename;
        const destinationFolder = args.destination_folder;

        if (!filename) {
            throw new Error("filename is required");
        }
        if (!destinationFolder) {
            throw new Error("destination_folder is required");
        }

        // Step 1: Unzip the file
        const zipPath = path.join(DOWNLOADS_DIR, filename);

        try {
            await fs.access(zipPath);
        } catch {
            throw new Error(`Zip file not found: ${filename}`);
        }

        const zip = new AdmZip(zipPath);
        const extractPath = path.join(DOWNLOADS_DIR, path.basename(filename, ".zip"));

        await fs.mkdir(extractPath, { recursive: true });
        zip.extractAllTo(extractPath, true);

        const entries = zip.getEntries();

        // Step 2: Find all SVG files in the extracted folder
        const svgFiles = await this.findFiles(extractPath, ".svg");

        if (svgFiles.length === 0) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Successfully unzipped ${filename} (${entries.length} files) to ${extractPath}\n\nBut no SVG files were found in the archive.`,
                    },
                ],
            };
        }

        // Step 3: Create destination folder in Documents
        const destDir = path.join(DOCUMENTS_DIR, destinationFolder);
        await fs.mkdir(destDir, { recursive: true });

        // Step 4: Move each SVG file
        const movedFiles = [];
        for (const svgPath of svgFiles) {
            const filename = path.basename(svgPath);
            const destPath = path.join(destDir, filename);

            // Handle duplicate filenames
            let finalDestPath = destPath;
            let counter = 1;
            while (true) {
                try {
                    await fs.access(finalDestPath);
                    const ext = path.extname(filename);
                    const base = path.basename(filename, ext);
                    finalDestPath = path.join(destDir, `${base}_${counter}${ext}`);
                    counter++;
                } catch {
                    break;
                }
            }

            await fs.rename(svgPath, finalDestPath);
            movedFiles.push(path.basename(finalDestPath));
        }

        return {
            content: [
                {
                    type: "text",
                    text: `Success! 🎉\n\n1. Unzipped ${args.filename} (${entries.length} total files)\n2. Found ${svgFiles.length} SVG file(s)\n3. Moved all SVGs to Documents\\${destinationFolder}\n\nMoved files:\n${movedFiles.join("\n")}`,
                },
            ],
        };
    }

    async handleCreateDirectory(args) {
        const name = args.name;
        if (!name) {
            throw new Error("name is required");
        }

        const location = (args.location || "documents").toLowerCase();

        let baseDir;
        if (location === "documents") {
            baseDir = DOCUMENTS_DIR;
        } else if (location === "downloads") {
            baseDir = DOWNLOADS_DIR;
        } else {
            baseDir = path.resolve(location);
        }

        const newDir = path.join(baseDir, name);

        try {
            await fs.access(newDir);
            return {
                content: [
                    {
                        type: "text",
                        text: `Directory already exists: ${newDir}`,
                    },
                ],
            };
        } catch {
            // Directory doesn't exist, create it
        }

        await fs.mkdir(newDir, { recursive: true });

        return {
            content: [
                {
                    type: "text",
                    text: `Successfully created directory: ${newDir}`,
                },
            ],
        };
    }

    async handleMoveLatestSvg(args) {
        const destinationFolder = args.destination_folder;
        if (!destinationFolder) {
            throw new Error("destination_folder is required");
        }

        const sourceDir = args.source
            ? path.resolve(args.source)
            : DOWNLOADS_DIR;

        try {
            await fs.access(sourceDir);
        } catch {
            throw new Error(`Source directory not found: ${sourceDir}`);
        }

        // Find all SVG files
        const svgFiles = await this.findFiles(sourceDir, ".svg");

        if (svgFiles.length === 0) {
            return {
                content: [
                    {
                        type: "text",
                        text: `No SVG files found in ${sourceDir}`,
                    },
                ],
            };
        }

        // Get the most recent SVG file by modification time
        const fileStats = await Promise.all(
            svgFiles.map(async (filePath) => {
                const stats = await fs.stat(filePath);
                return { filePath, mtime: stats.mtime };
            })
        );
        const latestSvg = fileStats.reduce((latest, current) =>
            current.mtime > latest.mtime ? current : latest
        ).filePath;

        // Create destination folder in Documents
        const destDir = path.join(DOCUMENTS_DIR, destinationFolder);
        await fs.mkdir(destDir, { recursive: true });

        // Determine destination path
        const svgName = path.basename(latestSvg);
        let finalDestPath = path.join(destDir, svgName);

        // Handle duplicate filenames
        let counter = 1;
        while (true) {
            try {
                await fs.access(finalDestPath);
                const ext = path.extname(svgName);
                const base = path.basename(svgName, ext);
                finalDestPath = path.join(destDir, `${base}_${counter}${ext}`);
                counter++;
            } catch {
                break;
            }
        }

        // Move the file
        await fs.rename(latestSvg, finalDestPath);

        return {
            content: [
                {
                    type: "text",
                    text: `Successfully moved the latest SVG file to ${finalDestPath}\n\nFile: ${svgName}`,
                },
            ],
        };
    }

    async handleCopyFile(args) {
        const filename = args.filename;
        if (!filename) {
            throw new Error("filename is required");
        }

        // Determine source directory
        const sourceArg = (args.source || "downloads").toLowerCase();
        let sourceDir;
        if (sourceArg === "downloads") {
            sourceDir = DOWNLOADS_DIR;
        } else if (sourceArg === "documents") {
            sourceDir = DOCUMENTS_DIR;
        } else {
            sourceDir = path.resolve(sourceArg);
        }

        let sourceFile = path.join(sourceDir, filename);

        try {
            await fs.access(sourceFile);
        } catch {
            // Try to find the file recursively
            const foundFiles = await this.findFiles(sourceDir, path.extname(filename));
            const match = foundFiles.find((f) => path.basename(f) === filename);
            if (match) {
                sourceFile = match;
            } else {
                throw new Error(`File not found: ${filename} in ${sourceDir}`);
            }
        }

        // Determine destination
        const destFolder = args.destination_folder || "";
        let destDir;
        if (destFolder) {
            destDir = path.join(DOCUMENTS_DIR, destFolder);
        } else {
            destDir = DOCUMENTS_DIR;
        }

        await fs.mkdir(destDir, { recursive: true });

        // Determine destination path
        const sourceName = path.basename(sourceFile);
        let finalDestPath = path.join(destDir, sourceName);

        // Handle duplicate filenames
        let counter = 1;
        while (true) {
            try {
                await fs.access(finalDestPath);
                const ext = path.extname(sourceName);
                const base = path.basename(sourceName, ext);
                finalDestPath = path.join(destDir, `${base}_${counter}${ext}`);
                counter++;
            } catch {
                break;
            }
        }

        // Copy the file
        await fs.copyFile(sourceFile, finalDestPath);

        return {
            content: [
                {
                    type: "text",
                    text: `Successfully copied ${sourceName} to ${finalDestPath}`,
                },
            ],
        };
    }

    async handleMoveFile(args) {
        const filename = args.filename;
        if (!filename) {
            throw new Error("filename is required");
        }

        // Determine source directory
        const sourceArg = (args.source || "downloads").toLowerCase();
        let sourceDir;
        if (sourceArg === "downloads") {
            sourceDir = DOWNLOADS_DIR;
        } else if (sourceArg === "documents") {
            sourceDir = DOCUMENTS_DIR;
        } else {
            sourceDir = path.resolve(sourceArg);
        }

        let sourceFile = path.join(sourceDir, filename);

        try {
            await fs.access(sourceFile);
        } catch {
            // Try to find the file recursively
            const foundFiles = await this.findFiles(sourceDir, path.extname(filename));
            const match = foundFiles.find((f) => path.basename(f) === filename);
            if (match) {
                sourceFile = match;
            } else {
                throw new Error(`File not found: ${filename} in ${sourceDir}`);
            }
        }

        // Determine destination
        const destFolder = args.destination_folder || "";
        let destDir;
        if (destFolder) {
            destDir = path.join(DOCUMENTS_DIR, destFolder);
        } else {
            destDir = DOCUMENTS_DIR;
        }

        await fs.mkdir(destDir, { recursive: true });

        // Determine destination path
        const sourceName = path.basename(sourceFile);
        let finalDestPath = path.join(destDir, sourceName);

        // Handle duplicate filenames
        let counter = 1;
        while (true) {
            try {
                await fs.access(finalDestPath);
                const ext = path.extname(sourceName);
                const base = path.basename(sourceName, ext);
                finalDestPath = path.join(destDir, `${base}_${counter}${ext}`);
                counter++;
            } catch {
                break;
            }
        }

        // Move the file
        await fs.rename(sourceFile, finalDestPath);

        return {
            content: [
                {
                    type: "text",
                    text: `Successfully moved ${filename} to ${finalDestPath}`,
                },
            ],
        };
    }

    async handleListFiles(args) {
        const limit = args?.limit || 20;
        const fileType = (args?.file_type || "").toLowerCase().replace(/^\./, "");

        // Determine directory
        const dirArg = (args?.directory || "downloads").toLowerCase();
        let searchDir;
        if (dirArg === "downloads") {
            searchDir = DOWNLOADS_DIR;
        } else if (dirArg === "documents") {
            searchDir = DOCUMENTS_DIR;
        } else if (dirArg.startsWith("documents/") || dirArg.startsWith("documents\\")) {
            const subfolder = dirArg.includes("/")
                ? dirArg.split("/").slice(1).join("/")
                : dirArg.split("\\").slice(1).join("\\");
            searchDir = path.join(DOCUMENTS_DIR, subfolder);
        } else if (dirArg.startsWith("downloads/") || dirArg.startsWith("downloads\\")) {
            const subfolder = dirArg.includes("/")
                ? dirArg.split("/").slice(1).join("/")
                : dirArg.split("\\").slice(1).join("\\");
            searchDir = path.join(DOWNLOADS_DIR, subfolder);
        } else {
            searchDir = path.resolve(dirArg);
        }

        try {
            await fs.access(searchDir);
        } catch {
            throw new Error(`Directory not found: ${searchDir}`);
        }

        // Get file details
        const entries = await fs.readdir(searchDir, { withFileTypes: true });
        let fileDetails = [];

        for (const entry of entries) {
            if (entry.isFile()) {
                try {
                    const fullPath = path.join(searchDir, entry.name);
                    const stats = await fs.stat(fullPath);
                    const extension = path.extname(entry.name).toLowerCase().replace(/^\./, "");
                    fileDetails.push({
                        name: entry.name,
                        size: stats.size,
                        modified: stats.mtime,
                        extension,
                    });
                } catch {
                    // Skip files that can't be stat'd
                }
            }
        }

        // Apply file type filter
        if (fileType) {
            fileDetails = fileDetails.filter((f) => f.extension === fileType);
        }

        if (fileDetails.length === 0) {
            const typeMsg = fileType ? ` of type '.${fileType}'` : "";
            return {
                content: [
                    {
                        type: "text",
                        text: `No files${typeMsg} found in ${searchDir}`,
                    },
                ],
            };
        }

        // Sort by modified date (newest first)
        fileDetails.sort((a, b) => b.modified - a.modified);

        // Limit results
        const limitedFiles = fileDetails.slice(0, limit);

        const fileList = limitedFiles.map((file, index) => {
            let displaySize;
            if (file.size > 1024 * 1024) {
                displaySize = `${(file.size / (1024 * 1024)).toFixed(2)} MB`;
            } else if (file.size > 1024) {
                displaySize = `${(file.size / 1024).toFixed(2)} KB`;
            } else {
                displaySize = `${file.size} bytes`;
            }

            const dateStr = file.modified.toLocaleString();
            const badge = index === 0 ? " [LATEST]" : "";
            return `${file.name}${badge}\n  Size: ${displaySize} | Modified: ${dateStr}`;
        });

        const typeMsg = fileType ? ` (filtered to .${fileType} files)` : "";
        return {
            content: [
                {
                    type: "text",
                    text: `Files in ${searchDir}${typeMsg}\nShowing ${limitedFiles.length} of ${fileDetails.length} (sorted by most recent):\n\n${fileList.join("\n\n")}`,
                },
            ],
        };
    }

    async run() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error("File Manager MCP server running on stdio");
    }
}

const server = new FileManagerServer();
server.run().catch(console.error);