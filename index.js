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
const DOCUMENTS_DIR = path.join(os.homedir(), "Documents");

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

    async run() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error("File Manager MCP server running on stdio");
    }
}

const server = new FileManagerServer();
server.run().catch(console.error);