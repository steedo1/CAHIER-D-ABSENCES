Option Explicit
Dim shell, fileSystem, scriptDirectory, command
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")
scriptDirectory = fileSystem.GetParentFolderName(WScript.ScriptFullName)
command = Chr(34) & fileSystem.BuildPath(scriptDirectory, "start-relay.cmd") & Chr(34)
shell.Run command, 0, False
